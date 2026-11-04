import type { ConceptAnalysis, TurnAnalysis } from "./analysis";
import {
  MAX_NODES,
  MAX_TRACES,
  type KnowledgeNode,
  type Pending,
  type Trace,
  type TrailState,
  type TurnCallout,
  type TurnPlan,
} from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How long after the last contact a concept is worth testing again. */
const RECALL_DUE_AFTER: Record<KnowledgeNode["state"], number> = {
  fuzzy: 1 * DAY,
  seen: 3 * DAY,
  solid: 14 * DAY,
  unseen: Number.POSITIVE_INFINITY,
};
/** Untouched this long, what was seen or known counts as faded. */
const FADE_AFTER = 30 * DAY;
/** A fuzzy concept just re-taught is not flagged as a hole again right away. */
const GAP_COOLDOWN = 1 * HOUR;
/** At most one recall check per sitting: a learner shouldn't feel interrogated. */
const RECALL_COOLDOWN = 10 * 60 * 1000;

const MAX_PREREQUISITES = 3;
const MAX_LABEL = 120;
const MAX_SUMMARY = 1_000;
const MAX_ANSWER_EXCERPT = 800;
const MAX_TRACE_CONTENT = 2_000;

export function normalizeLabel(label: string): string {
  return label.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

export function findByLabel(
  nodes: KnowledgeNode[],
  label: string,
): KnowledgeNode | undefined {
  const wanted = normalizeLabel(label);
  return nodes.find((node) => normalizeLabel(node.label) === wanted);
}

export function findById(
  nodes: KnowledgeNode[],
  id: string | null,
): KnowledgeNode | undefined {
  return nodes.find((node) => node.id === id);
}

/** Lets what was seen or known fade when it has gone untouched for too long. */
export function fadeStaleNodes(trail: TrailState, now: number): TrailState {
  return {
    ...trail,
    nodes: trail.nodes.map((node) =>
      (node.state === "seen" || node.state === "solid") &&
      now - node.lastTouchedAt >= FADE_AFTER
        ? { ...node, state: "fuzzy" }
        : node,
    ),
  };
}

/** Moves the whole trail into the past, to simulate time passing. */
export function advanceTime(
  trail: TrailState,
  ms: number,
  now: number,
): TrailState {
  const earlier = (time: number) => Math.max(0, time - ms);
  const earlierOrNull = (time: number | null) =>
    time === null ? null : earlier(time);

  return fadeStaleNodes(
    {
      ...trail,
      nodes: trail.nodes.map((node) => ({
        ...node,
        firstSeenAt: earlier(node.firstSeenAt),
        lastTouchedAt: earlier(node.lastTouchedAt),
        lastCheckedAt: earlierOrNull(node.lastCheckedAt),
        lastPromptedAt: earlierOrNull(node.lastPromptedAt),
      })),
      traces: trail.traces.map((trace) => ({
        ...trace,
        createdAt: earlier(trace.createdAt),
      })),
    },
    now,
  );
}

export function isRecallDue(node: KnowledgeNode, now: number): boolean {
  const lastContact = Math.max(
    node.lastTouchedAt,
    node.lastCheckedAt ?? 0,
    node.lastPromptedAt ?? 0,
  );
  return now - lastContact >= RECALL_DUE_AFTER[node.state];
}

function isHole(node: KnowledgeNode, now: number): boolean {
  return (
    node.state === "unseen" ||
    (node.state === "fuzzy" && now - node.lastTouchedAt >= GAP_COOLDOWN)
  );
}

/** The latest explanation the learner got for a concept, to re-teach from. */
export function lastAnswerFor(
  trail: TrailState,
  nodeId: string,
): string | null {
  const trace = trail.traces.findLast(
    (candidate) =>
      candidate.type === "answer" && candidate.nodeIds.includes(nodeId),
  );
  return trace?.content ?? null;
}

export interface TurnMessage {
  text: string;
  imageId: string | null;
}

export interface TurnContext {
  now: number;
  /** Random in production, fixed in tests. */
  newId: () => string;
}

type NewTrace = Pick<Trace, "type" | "content" | "nodeIds"> &
  Partial<Pick<Trace, "imageId" | "verdict">>;

class TrailDraft {
  nodes: KnowledgeNode[];
  traces: Trace[];

  constructor(
    trail: TrailState,
    private context: TurnContext,
  ) {
    this.nodes = trail.nodes.map((node) => ({ ...node }));
    this.traces = [...trail.traces];
  }

  addTrace(trace: NewTrace) {
    const added: Trace = {
      imageId: null,
      verdict: null,
      ...trace,
      id: this.context.newId(),
      content: trace.content.slice(0, MAX_TRACE_CONTENT),
      createdAt: this.context.now,
    };
    this.traces = [...this.traces, added].slice(-MAX_TRACES);
    for (const node of this.nodes) {
      if (added.nodeIds.includes(node.id)) {
        node.sources = [...node.sources, added.id].slice(-MAX_TRACES);
      }
    }
  }

  /** A missing concept starts as a hole, until the learner actually meets it. */
  ensureNode(label: string): KnowledgeNode | null {
    const existing = findByLabel(this.nodes, label);
    if (existing) return existing;

    const trimmed = label.trim().slice(0, MAX_LABEL);
    if (!trimmed || this.nodes.length >= MAX_NODES) return null;

    const node: KnowledgeNode = {
      id: this.context.newId(),
      label: trimmed,
      summary: "",
      state: "unseen",
      parentId: null,
      prerequisiteIds: [],
      sources: [],
      firstSeenAt: this.context.now,
      lastTouchedAt: this.context.now,
      lastCheckedAt: null,
      lastPromptedAt: null,
    };
    this.nodes.push(node);
    return node;
  }

  meet(node: KnowledgeNode) {
    if (node.state === "unseen") {
      node.state = "seen";
      node.firstSeenAt = this.context.now;
    }
    node.lastTouchedAt = this.context.now;
  }

  /** Refuses a link that would make a concept its own ancestor. */
  setParent(child: KnowledgeNode, parent: KnowledgeNode) {
    for (
      let ancestor: KnowledgeNode | undefined = parent;
      ancestor;
      ancestor = findById(this.nodes, ancestor.parentId)
    ) {
      if (ancestor.id === child.id) return;
    }
    child.parentId = parent.id;
  }
}

function placeConcepts(draft: TrailDraft, concepts: ConceptAnalysis[]) {
  // Every concept exists before any link is made, so concepts in one response
  // can refer to each other in any order.
  const placed = concepts.flatMap((concept) => {
    const node = draft.ensureNode(concept.label);
    if (!node) return [];
    const isNew = node.state === "unseen" && node.sources.length === 0;
    draft.meet(node);
    const summary = concept.summary.trim().slice(0, MAX_SUMMARY);
    if (summary) node.summary = summary;
    return [{ concept, node, isNew }];
  });

  for (const { concept, node } of placed) {
    const parent = concept.parentLabel
      ? findByLabel(draft.nodes, concept.parentLabel)
      : undefined;
    if (parent) draft.setParent(node, parent);

    for (const childLabel of concept.childLabels) {
      const child = findByLabel(draft.nodes, childLabel);
      if (child) draft.setParent(child, node);
    }

    const prerequisites = concept.prerequisites
      .slice(0, MAX_PREREQUISITES)
      .flatMap((label) => draft.ensureNode(label) ?? [])
      .filter((prerequisite) => prerequisite.id !== node.id);
    node.prerequisiteIds = [
      ...new Set([
        ...node.prerequisiteIds,
        ...prerequisites.map((prerequisite) => prerequisite.id),
      ]),
    ];
  }

  return placed;
}

/**
 * The one hole worth stopping for, if any. A prerequisite the model calls
 * blocking counts when it is missing or fuzzy. Any other prerequisite counts only
 * when it is fuzzy: the learner has already shown they lost it, whereas a merely
 * unseen one can wait quietly on the map rather than interrupt every question.
 */
function pickHole(
  focus: KnowledgeNode,
  analysis: ConceptAnalysis | undefined,
  nodes: KnowledgeNode[],
  now: number,
): KnowledgeNode | undefined {
  const blocking = analysis?.blockingPrerequisite
    ? findByLabel(nodes, analysis.blockingPrerequisite)
    : undefined;
  if (blocking && blocking.id !== focus.id && isHole(blocking, now)) {
    return blocking;
  }
  return focus.prerequisiteIds
    .flatMap((id) => findById(nodes, id) ?? [])
    .find((prerequisite) => prerequisite.state === "fuzzy" && isHole(prerequisite, now));
}

/** Concepts worth testing when the conversation is on `focus`, closest first. */
function relatedConcepts(focus: KnowledgeNode, nodes: KnowledgeNode[]) {
  return [
    focus,
    ...focus.prerequisiteIds.flatMap((id) => findById(nodes, id) ?? []),
    ...nodes.filter((node) => node.id === focus.parentId),
    ...nodes.filter((node) => node.parentId === focus.id),
  ];
}

function pickRecall(
  candidates: KnowledgeNode[],
  before: TrailState,
  now: number,
): KnowledgeNode | undefined {
  const checkedRecently = before.nodes.some(
    (node) =>
      node.lastPromptedAt !== null &&
      now - node.lastPromptedAt < RECALL_COOLDOWN,
  );
  if (checkedRecently) return undefined;

  // Judge by the state before this turn: having just asked about a concept is
  // no evidence of remembering it, and it is what brought the concept back up.
  return candidates.find((candidate) => {
    const previous = findById(before.nodes, candidate.id);
    return previous !== undefined && isRecallDue(previous, now);
  });
}

function oldestFirst(nodes: KnowledgeNode[]) {
  return [...nodes].sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
}

export interface TurnResult {
  trail: TrailState;
  plan: TurnPlan;
  callout: TurnCallout;
}

/**
 * Applies one learner turn to the trail and decides what the reply must do.
 * The model reads the turn. What changes on the map, and whether this turn fills
 * a hole or tests memory, is decided here, so the behaviour does not depend on
 * how a reply happens to be worded. `analysis` is null when the model's reading
 * failed: the conversation then carries on without touching the map.
 */
export function applyTurn(
  input: TrailState,
  message: TurnMessage,
  analysis: TurnAnalysis | null,
  context: TurnContext,
): TurnResult {
  const { now } = context;
  const before = fadeStaleNodes(input, now);
  const draft = new TrailDraft(before, context);
  const question = (
    message.text.trim() ||
    analysis?.imageDescription?.trim() ||
    ""
  ).slice(0, MAX_TRACE_CONTENT);

  let placedLabels: TurnCallout["placed"] = [];

  const finish = (plan: TurnPlan, pending: Pending | null): TurnResult => {
    const trail: TrailState = {
      nodes: draft.nodes,
      traces: draft.traces,
      pending,
      focusId: planFocusId(plan) ?? before.focusId,
    };
    return {
      trail,
      plan,
      callout: describePlan(plan, trail, placedLabels, analysis),
    };
  };

  const askRecall = (node: KnowledgeNode, returnToId: string | null) => {
    node.lastPromptedAt = now;
    return finish(
      { kind: "recall_ask", nodeId: node.id },
      { kind: "recall", nodeId: node.id, originalQuestion: question, returnToId },
    );
  };

  // A reply to what the last turn asked. Anything else just moves on: an ignored
  // recall check is dropped and never repeated.
  const pending = before.pending;
  if (pending?.kind === "recall") {
    const node = findById(draft.nodes, pending.nodeId);
    const verdict = analysis?.recallVerdict;
    if (node && (verdict === "solid" || verdict === "fuzzy")) {
      node.state = verdict;
      node.lastCheckedAt = now;
      node.lastTouchedAt = now;
      draft.addTrace({
        type: "recall_check",
        content: message.text,
        nodeIds: [node.id],
        verdict,
      });
      return finish(
        {
          kind: "recall_result",
          nodeId: node.id,
          verdict,
          note: analysis?.recallNote?.trim() ?? "",
          originalQuestion: pending.originalQuestion,
          returnToId: pending.returnToId,
        },
        null,
      );
    }
  }
  if (pending?.kind === "revisit") {
    const node = findById(draft.nodes, pending.nodeId);
    const choice = analysis?.revisitChoice;
    if (node && (choice === "continue" || choice === "review")) {
      node.lastTouchedAt = now;
      draft.addTrace({
        type: "question",
        content: message.text,
        nodeIds: [node.id],
      });
      return finish(
        {
          kind: "revisit_resume",
          nodeId: node.id,
          choice,
          originalQuestion: pending.originalQuestion,
        },
        null,
      );
    }
  }

  if (!analysis) {
    draft.addTrace({
      type: message.imageId ? "drop" : "question",
      content: question,
      nodeIds: [],
      imageId: message.imageId,
    });
    return finish({ kind: "answer", focusId: null }, null);
  }

  const previousTrace = before.traces.findLast(
    (trace) => trace.type === "question" || trace.type === "drop",
  );
  const placed = placeConcepts(draft, analysis.concepts);
  placedLabels = placed.map(({ node, isNew }) => ({
    label: node.label,
    isNew,
  }));
  const focus =
    (analysis.focusLabel && findByLabel(draft.nodes, analysis.focusLabel)) ||
    placed[0]?.node;
  if (focus) draft.meet(focus);

  if (message.imageId || focus) {
    draft.addTrace({
      type: message.imageId ? "drop" : "question",
      content: question,
      nodeIds: [
        ...new Set([
          ...(focus ? [focus.id] : []),
          ...placed.map(({ node }) => node.id),
        ]),
      ],
      imageId: message.imageId,
    });
  }

  if (analysis.moment === "broad_wish") {
    return finish({ kind: "open" }, null);
  }

  // Finishing a topic is a natural moment to test the oldest thing: if nothing
  // is due, it stays a plain "what next?" and never becomes a list of topics.
  if (analysis.moment === "wrapping_up") {
    const overdue = pickRecall(oldestFirst(draft.nodes), before, now);
    if (overdue) return askRecall(overdue, null);
    const hole = draft.nodes.find((node) => node.state === "unseen");
    return finish({ kind: "wander", holeId: hole?.id ?? null }, null);
  }

  if (!focus) return finish({ kind: "answer", focusId: null }, null);

  // One thing at a time: fill a hole, else test memory, else acknowledge a
  // return. Only one of them happens in a turn.
  const focusAnalysis = analysis.concepts.find(
    (concept) => normalizeLabel(concept.label) === normalizeLabel(focus.label),
  );
  const hole = pickHole(focus, focusAnalysis, draft.nodes, now);
  if (hole) {
    return finish(
      {
        kind: "gap",
        focusId: focus.id,
        gapId: hole.id,
        reason: hole.state === "unseen" ? "never_seen" : "fuzzy",
      },
      null,
    );
  }

  const recallNode = pickRecall(relatedConcepts(focus, draft.nodes), before, now);
  if (recallNode) return askRecall(recallNode, focus.id);

  const previous = findById(before.nodes, focus.id);
  const isFollowUp = previousTrace?.nodeIds.includes(focus.id) ?? false;
  if (
    analysis.moment === "coming_back" &&
    previous &&
    previous.state !== "unseen" &&
    !isFollowUp
  ) {
    return finish(
      { kind: "revisit_offer", nodeId: focus.id },
      { kind: "revisit", nodeId: focus.id, originalQuestion: question },
    );
  }

  return finish({ kind: "answer", focusId: focus.id }, null);
}

/** Runs once the reply has been delivered in full: what it explained now counts. */
export function completeTurn(
  trail: TrailState,
  plan: TurnPlan,
  reply: string,
  context: TurnContext,
): TrailState {
  const draft = new TrailDraft(trail, context);
  const excerpt = reply.trim().slice(0, MAX_ANSWER_EXCERPT);
  const addAnswer = (nodeIds: string[]) => {
    if (excerpt) {
      draft.addTrace({
        type: "answer",
        content: excerpt,
        nodeIds: [...new Set(nodeIds)],
      });
    }
  };

  switch (plan.kind) {
    case "gap": {
      const hole = findById(draft.nodes, plan.gapId);
      if (hole) {
        // Re-taught, so no longer a hole, but still untested: back to "seen".
        if (hole.state === "fuzzy") hole.state = "seen";
        draft.meet(hole);
      }
      addAnswer([plan.gapId, plan.focusId]);
      break;
    }
    case "answer":
      if (plan.focusId) addAnswer([plan.focusId]);
      break;
    case "recall_result":
      // A failed check stays fuzzy even though it was just re-taught: being told
      // again is not remembering. Only a passed check clears it.
      addAnswer(
        plan.returnToId ? [plan.nodeId, plan.returnToId] : [plan.nodeId],
      );
      break;
    case "revisit_resume":
      addAnswer([plan.nodeId]);
      break;
    case "open":
    case "recall_ask":
    case "revisit_offer":
    case "wander":
      break;
  }

  return { ...trail, nodes: draft.nodes, traces: draft.traces };
}

/** The concept a turn left off on, for the "you are here" marker. */
function planFocusId(plan: TurnPlan): string | null {
  switch (plan.kind) {
    case "answer":
    case "gap":
      return plan.focusId;
    case "recall_ask":
    case "revisit_offer":
    case "revisit_resume":
      return plan.nodeId;
    case "recall_result":
      return plan.returnToId ?? plan.nodeId;
    case "open":
    case "wander":
      return null;
  }
}

function describePlan(
  plan: TurnPlan,
  trail: TrailState,
  placed: TurnCallout["placed"],
  analysis: TurnAnalysis | null,
): TurnCallout {
  const label = (id: string | null) => findById(trail.nodes, id)?.label ?? null;

  const nodeId =
    plan.kind === "gap"
      ? plan.gapId
      : plan.kind === "wander"
        ? plan.holeId
        : "nodeId" in plan
          ? plan.nodeId
          : null;
  const focusId =
    plan.kind === "gap" || plan.kind === "answer"
      ? plan.focusId
      : plan.kind === "recall_result"
        ? plan.returnToId
        : null;

  return {
    kind: plan.kind,
    nodeLabel: label(nodeId),
    focusLabel: label(focusId),
    reason: plan.kind === "gap" ? plan.reason : null,
    verdict: plan.kind === "recall_result" ? plan.verdict : null,
    placed,
    imageDescription: analysis?.imageDescription?.trim() || null,
  };
}
