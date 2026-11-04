import type { ConceptAnalysis, TurnAnalysis } from "./analysis";
import {
  MAX_LABEL,
  MAX_NODE_PREREQUISITES,
  MAX_NODE_SOURCES,
  MAX_NODES,
  MAX_REGION_CONCEPT,
  MAX_SUMMARY,
  MAX_TRACE_CONTENT,
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
/** Asking again within this long continues the talk. After it, it's coming back. */
const FOLLOW_UP_WINDOW = 1 * HOUR;

const MAX_PREREQUISITES = 3;
const MAX_CONCEPTS_PER_TURN = 3;
const MAX_ANSWER_EXCERPT = 800;

/** Cut to the stored length first, so an overlong label still finds its node. */
export function normalizeLabel(label: string): string {
  return label
    .trim()
    .slice(0, MAX_LABEL)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
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
        node.sources = [...node.sources, added.id].slice(-MAX_NODE_SOURCES);
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

  /**
   * Refuses a link that would make a concept its own ancestor. The trail comes
   * from the browser, so it may already hold a cycle: `visited` stops the walk.
   */
  setParent(child: KnowledgeNode, parent: KnowledgeNode) {
    const visited = new Set<string>();
    for (
      let ancestor: KnowledgeNode | undefined = parent;
      ancestor && !visited.has(ancestor.id);
      ancestor = findById(this.nodes, ancestor.parentId)
    ) {
      if (ancestor.id === child.id) return;
      visited.add(ancestor.id);
    }
    child.parentId = parent.id;
  }
}

function placeConcepts(draft: TrailDraft, concepts: ConceptAnalysis[]) {
  // Every concept exists before any link is made, so concepts in one response
  // can refer to each other in any order. Two spellings of one concept count once.
  const placed: { concept: ConceptAnalysis; node: KnowledgeNode }[] = [];
  for (const concept of concepts.slice(0, MAX_CONCEPTS_PER_TURN)) {
    const node = draft.ensureNode(concept.label);
    if (!node || placed.some((entry) => entry.node.id === node.id)) continue;
    draft.meet(node);
    const summary = concept.summary.trim().slice(0, MAX_SUMMARY);
    if (summary) node.summary = summary;
    placed.push({ concept, node });
  }

  for (const { concept, node } of placed) {
    const parent = concept.parentLabel
      ? findByLabel(draft.nodes, concept.parentLabel)
      : undefined;
    if (parent) draft.setParent(node, parent);

    for (const childLabel of concept.childLabels) {
      const child = findByLabel(draft.nodes, childLabel);
      if (child) draft.setParent(child, node);
    }

    const prerequisites = prerequisiteLabels(concept, node)
      .slice(0, MAX_PREREQUISITES)
      .flatMap((label) => draft.ensureNode(label) ?? []);
    node.prerequisiteIds = [
      ...new Set([
        ...node.prerequisiteIds,
        ...prerequisites.map((prerequisite) => prerequisite.id),
      ]),
    ].slice(-MAX_NODE_PREREQUISITES);
  }

  return placed;
}

/**
 * The blocking prerequisite comes first, so the limit can never cut it off and
 * a model that leaves it out of the list still gets it linked.
 */
function prerequisiteLabels(concept: ConceptAnalysis, node: KnowledgeNode) {
  const taken = new Set([normalizeLabel(node.label)]);
  return [concept.blockingPrerequisite, ...concept.prerequisites].filter(
    (label): label is string => {
      const key = normalizeLabel(label ?? "");
      if (!key || taken.has(key)) return false;
      taken.add(key);
      return true;
    },
  );
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
  before: TrailState,
  now: number,
): KnowledgeNode | undefined {
  // Fuzziness settles by when it was last touched before this turn: being
  // mentioned just now doesn't mean it was just re-taught.
  const isFuzzyHole = (node: KnowledgeNode) => {
    const lastTouchedAt = findById(before.nodes, node.id)?.lastTouchedAt ?? now;
    return node.state === "fuzzy" && now - lastTouchedAt >= GAP_COOLDOWN;
  };

  const blocking = analysis?.blockingPrerequisite
    ? findByLabel(nodes, analysis.blockingPrerequisite)
    : undefined;
  if (
    blocking &&
    blocking.id !== focus.id &&
    (blocking.state === "unseen" || isFuzzyHole(blocking))
  ) {
    return blocking;
  }
  return focus.prerequisiteIds
    .flatMap((id) => findById(nodes, id) ?? [])
    .find(isFuzzyHole);
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

  const finish = (plan: TurnPlan, pending: Pending | null = null): TurnResult => {
    const trail: TrailState = {
      nodes: draft.nodes,
      traces: draft.traces,
      pending,
      focusId: planFocusId(plan) ?? before.focusId,
    };
    return {
      trail,
      plan,
      callout: describePlan(
        plan,
        trail,
        placedLabels,
        message.imageId ? analysis : null,
      ),
    };
  };

  // Asking about a concept isn't being told about it. When a turn puts the answer
  // off, whatever it newly brought up stays unseen until a reply explains it.
  const postponeExplanations = () => {
    for (const node of draft.nodes) {
      const previous = findById(before.nodes, node.id);
      const wasUnseen = !previous || previous.state === "unseen";
      if (node.state === "seen" && wasUnseen) node.state = "unseen";
    }
  };

  const askRecall = (node: KnowledgeNode, returnToId: string | null) => {
    postponeExplanations();
    return finish({
      kind: "recall_ask",
      nodeId: node.id,
      // "What's next?" is no question to return to: answering it after the check
      // would mean suggesting a topic.
      originalQuestion: returnToId ? question : "",
      returnToId,
    });
  };

  // A reply to what the last turn asked. Anything else just moves on: an ignored
  // recall check is dropped and never repeated. A thrown image is for the map, so
  // it is never taken as a reply.
  const pending = message.imageId ? null : before.pending;
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
      return finish({
        kind: "recall_result",
        nodeId: node.id,
        verdict,
        note: analysis?.recallNote?.trim().slice(0, MAX_SUMMARY) ?? "",
        originalQuestion: pending.originalQuestion,
        returnToId: pending.returnToId,
      });
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
      return finish({
        kind: "revisit_resume",
        nodeId: node.id,
        choice,
        originalQuestion: pending.originalQuestion,
      });
    }
  }

  if (!analysis) {
    draft.addTrace({
      type: message.imageId ? "drop" : "question",
      content: question,
      nodeIds: [],
      imageId: message.imageId,
    });
    // The reading failed, not the learner. Whatever was waiting can still be
    // answered on the next turn.
    return finish({ kind: "answer", focusId: null }, before.pending);
  }

  const previousTrace = before.traces.findLast(
    (trace) => trace.type === "question" || trace.type === "drop",
  );
  const placed = placeConcepts(draft, analysis.concepts);
  placedLabels = placed.map(({ node }) => node.label);
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

  // An image sent with a question needs its answer now: it won't be there on the
  // next turn. So it is never put off, whatever else the message seems to be.
  const asksAboutImage = message.imageId !== null && message.text.trim() !== "";

  if (analysis.moment === "broad_wish" && !asksAboutImage) {
    return finish({ kind: "open" });
  }

  // Finishing a topic is a natural moment to test the oldest thing: if nothing
  // is due, it stays a plain "what next?" and never becomes a list of topics.
  if (analysis.moment === "wrapping_up" && !asksAboutImage) {
    const overdue = pickRecall(oldestFirst(draft.nodes), before, now);
    if (overdue) return askRecall(overdue, null);
    const hole = draft.nodes.find((node) => node.state === "unseen");
    return finish({ kind: "wander", holeId: hole?.id ?? null });
  }

  if (!focus) return finish({ kind: "answer", focusId: null });

  // One thing at a time: fill a hole, else test memory, else acknowledge a
  // return. Only one of them happens in a turn.
  const focusAnalysis = analysis.concepts.find(
    (concept) => normalizeLabel(concept.label) === normalizeLabel(focus.label),
  );
  const hole = pickHole(focus, focusAnalysis, draft.nodes, before, now);
  if (hole) {
    return finish({
      kind: "gap",
      focusId: focus.id,
      gapId: hole.id,
      reason: hole.state === "unseen" ? "never_seen" : "fuzzy",
    });
  }

  // A thrown image alone can be the moment for a check: it may connect to
  // something seen before.
  const recallNode = asksAboutImage
    ? undefined
    : pickRecall(relatedConcepts(focus, draft.nodes), before, now);
  if (recallNode) return askRecall(recallNode, focus.id);

  const previous = findById(before.nodes, focus.id);
  const isFollowUp =
    previousTrace !== undefined &&
    previousTrace.nodeIds.includes(focus.id) &&
    now - previousTrace.createdAt < FOLLOW_UP_WINDOW;
  if (
    analysis.moment === "coming_back" &&
    !message.imageId &&
    previous &&
    previous.state !== "unseen" &&
    !isFollowUp
  ) {
    postponeExplanations();
    return finish({
      kind: "revisit_offer",
      nodeId: focus.id,
      originalQuestion: question,
    });
  }

  return finish({ kind: "answer", focusId: focus.id });
}

/** Runs once the reply has been delivered in full: what it explained now counts. */
export function completeTurn(
  trail: TrailState,
  plan: TurnPlan,
  reply: string,
  context: TurnContext,
): TrailState {
  const draft = new TrailDraft(trail, context);
  let pending = trail.pending;
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
    case "recall_result": {
      // The question the check interrupted has now been answered.
      const returnTo = findById(draft.nodes, plan.returnToId);
      if (returnTo) draft.meet(returnTo);

      // Only what this reply explained counts as explained. A passed check is
      // acknowledged, not re-taught, so the concept keeps its earlier explanation
      // for later re-teaching and grading. A failed check stays fuzzy even though
      // it was just re-taught: being told again is not remembering.
      const explained = [
        ...(plan.verdict === "fuzzy" ? [plan.nodeId] : []),
        ...(plan.returnToId ? [plan.returnToId] : []),
      ];
      if (explained.length > 0) addAnswer(explained);
      break;
    }
    case "revisit_resume":
      addAnswer([plan.nodeId]);
      break;
    // A question only counts as asked once it has reached the learner. Otherwise
    // their next message would be graded against something they never saw.
    case "recall_ask": {
      const node = findById(draft.nodes, plan.nodeId);
      if (node) node.lastPromptedAt = context.now;
      pending = {
        kind: "recall",
        nodeId: plan.nodeId,
        originalQuestion: plan.originalQuestion,
        returnToId: plan.returnToId,
      };
      break;
    }
    case "revisit_offer":
      pending = {
        kind: "revisit",
        nodeId: plan.nodeId,
        originalQuestion: plan.originalQuestion,
      };
      break;
    case "open":
    case "wander":
      break;
  }

  return { ...trail, nodes: draft.nodes, traces: draft.traces, pending };
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
  dropAnalysis: TurnAnalysis | null,
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
    imageDescription:
      dropAnalysis?.imageDescription?.trim().slice(0, MAX_SUMMARY) || null,
    keyRegion:
      dropAnalysis?.keyRegion?.trim().slice(0, MAX_REGION_CONCEPT) || null,
  };
}
