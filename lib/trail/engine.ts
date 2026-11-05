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
/**
 * Curiosity comes first, so nothing is offered up front. After this many questions
 * there is enough of a trail to suggest where it could go, without being asked.
 */
const QUESTIONS_BEFORE_OFFER = 3;
const MAX_NEXT_STEPS = 3;
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

  /**
   * Told about it: only once a reply explaining it has been delivered. Merely being
   * brought up changes nothing, or an undelivered reply would put off a due check.
   */
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
  askedNow: KnowledgeNode[],
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
  // A concept they are asking about right now gets explained anyway.
  const isAskedNow = (node: KnowledgeNode) =>
    askedNow.some((asked) => asked.id === node.id);
  if (
    blocking &&
    blocking.id !== focus.id &&
    ((blocking.state === "unseen" && !isAskedNow(blocking)) ||
      isFuzzyHole(blocking))
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

/**
 * A short path from the model's suggestions: somewhere new, or a hole or fuzzy spot
 * on the map, but not ground already covered or what this turn is already explaining.
 */
function pickNextSteps(
  labels: string[],
  nodes: KnowledgeNode[],
  excludeIds: string[],
): string[] {
  const taken = new Set<string>();
  const steps: string[] = [];
  for (const label of labels) {
    const key = normalizeLabel(label);
    if (!key || taken.has(key) || steps.length === MAX_NEXT_STEPS) continue;
    taken.add(key);

    const node = findByLabel(nodes, label);
    const isCovered = node?.state === "seen" || node?.state === "solid";
    if (isCovered || (node && excludeIds.includes(node.id))) continue;
    steps.push(node?.label ?? label.trim().slice(0, MAX_LABEL));
  }
  return steps;
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
  let nextSteps: string[] = [];
  let questionsSinceOffer = before.questionsSinceOffer;

  const finish = (plan: TurnPlan, pending: Pending | null = null): TurnResult => {
    const trail: TrailState = {
      nodes: draft.nodes,
      traces: draft.traces,
      pending,
      focusId: planFocusId(plan) ?? before.focusId,
      questionsSinceOffer,
    };
    return {
      trail,
      plan,
      callout: describePlan(
        plan,
        trail,
        placedLabels,
        message.imageId ? analysis : null,
        nextSteps,
      ),
    };
  };

  const askRecall = (node: KnowledgeNode, returnToId: string | null) =>
    finish({
      kind: "recall_ask",
      nodeId: node.id,
      originalQuestion: question,
      returnToId,
    });

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
      // The reply answers the original question, so it carries over what that
      // question was about, including anything new the offer put off.
      const original = before.traces.findLast(
        (trace) => trace.type === "question",
      );
      draft.addTrace({
        type: "question",
        content: message.text,
        nodeIds: [...new Set([node.id, ...(original?.nodeIds ?? [])])],
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

  // A broad wish gets only one delivered clarification. Keep the named topics
  // off the map until an explanation starts, but retain them for "just tell me".
  const opening = pending?.kind === "open" ? pending : null;
  const topicLabels = analysis.concepts
    .slice(0, MAX_CONCEPTS_PER_TURN)
    .map(({ label }) => label.trim().slice(0, MAX_LABEL))
    .filter(Boolean);
  const asksAboutImage = message.imageId !== null && message.text.trim() !== "";
  if (analysis.moment === "broad_wish" && !message.imageId && !opening) {
    return finish({ kind: "open", originalQuestion: question, topicLabels });
  }
  if (opening && analysis.moment === "other" && analysis.concepts.length === 0) {
    // Small talk does not spend another clarification or force the topic back.
    return finish({ kind: "answer", focusId: null }, opening);
  }

  const startsLearning =
    !message.imageId &&
    (analysis.moment === "start_learning" ||
      (opening !== null && analysis.moment === "broad_wish"));
  // Even an incomplete reading of an opening reply can use the earlier topics.
  // They came from the learner, not a default curriculum chosen by the model.
  const concepts =
    startsLearning && analysis.concepts.length === 0 && opening
      ? opening.topicLabels.map((label): ConceptAnalysis => ({
          label,
          summary: "",
          parentLabel: null,
          childLabels: [],
          prerequisites: [],
          blockingPrerequisite: null,
        }))
      : analysis.concepts;
  const previousTrace = before.traces.findLast(
    (trace) => trace.type === "question" || trace.type === "drop",
  );
  const placed = placeConcepts(
    draft,
    startsLearning
      ? concepts.map((concept) => ({
          ...concept,
          prerequisites: [],
          blockingPrerequisite: null,
        }))
      : concepts,
  );
  placedLabels = placed.map(({ node }) => node.label);
  const focus =
    (analysis.focusLabel && findByLabel(draft.nodes, analysis.focusLabel)) ||
    placed[0]?.node;
  if (focus) questionsSinceOffer += 1;

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

  if (startsLearning) {
    // Broad wording must not erase an existing concept's due memory check.
    if (focus) {
      const recall = pickRecall(relatedConcepts(focus, draft.nodes), before, now);
      if (recall) return askRecall(recall, focus.id);
    }
    const topics =
      topicLabels.length > 0 ? topicLabels : opening?.topicLabels ?? [];
    return finish(
      { kind: "start", focusId: focus?.id ?? null, topicLabels: topics },
      // If the explanation is stopped, retain the fact that we already asked,
      // together with any more recent topic the learner chose.
      opening
        ? {
            kind: "open",
            originalQuestion:
              topicLabels.length > 0 ? question : opening.originalQuestion,
            topicLabels: topics,
          }
        : null,
    );
  }

  // Finishing a topic is a natural moment to test the oldest thing. If nothing is
  // due, "what's next?" gets a short path, because that is what they asked for.
  // A question about an attached image is answered now: the image is not resent.
  if (analysis.moment === "wrapping_up" && !asksAboutImage) {
    const overdue = pickRecall(oldestFirst(draft.nodes), before, now);
    if (overdue) return askRecall(overdue, null);
    const hole = draft.nodes.find((node) => node.state === "unseen");
    nextSteps = pickNextSteps(analysis.nextSteps, draft.nodes, []);
    if (nextSteps.length > 0) questionsSinceOffer = 0;
    return finish({
      kind: "wander",
      holeId: hole?.id ?? null,
      steps: nextSteps,
    });
  }

  if (!focus) return finish({ kind: "answer", focusId: null });

  // One thing at a time: test memory, else fill a hole, else acknowledge a return.
  // A check only comes up after days away and at most once a sitting, while a hole
  // can be filled on any turn, so a check that is due goes first.
  const focusAnalysis = analysis.concepts.find(
    (concept) => normalizeLabel(concept.label) === normalizeLabel(focus.label),
  );
  // Offered next to an answer, once enough questions have made a trail to go on.
  const askedNow = [focus, ...placed.map(({ node }) => node)];
  const offerNextSteps = (exclude: KnowledgeNode[]) => {
    if (questionsSinceOffer < QUESTIONS_BEFORE_OFFER) return;
    nextSteps = pickNextSteps(
      analysis.nextSteps,
      draft.nodes,
      exclude.map(({ id }) => id),
    );
    if (nextSteps.length > 0) questionsSinceOffer = 0;
  };

  // A thrown image alone can be the moment for a check: it may connect to
  // something seen before.
  const recallNode = asksAboutImage
    ? undefined
    : pickRecall(relatedConcepts(focus, draft.nodes), before, now);
  if (recallNode) return askRecall(recallNode, focus.id);

  const hole = pickHole(focus, focusAnalysis, draft.nodes, askedNow, before, now);
  if (hole) {
    offerNextSteps([...askedNow, hole]);
    return finish({
      kind: "gap",
      focusId: focus.id,
      gapId: hole.id,
      reason: hole.state === "unseen" ? "never_seen" : "fuzzy",
    });
  }

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
    return finish({
      kind: "revisit_offer",
      nodeId: focus.id,
      originalQuestion: question,
    });
  }

  offerNextSteps(askedNow);
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
  // Every concept the question was about, not only the main one. After a recall
  // check this is still the question the check interrupted.
  const asked =
    trail.traces.findLast(
      (trace) => trace.type === "question" || trace.type === "drop",
    )?.nodeIds ?? [];
  const meetAll = (nodeIds: string[]) => {
    for (const id of nodeIds) {
      const node = findById(draft.nodes, id);
      if (node) draft.meet(node);
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
      meetAll(asked);
      addAnswer([plan.gapId, plan.focusId, ...asked]);
      break;
    }
    case "start":
    case "answer":
      if (plan.kind === "start") pending = null;
      if (plan.focusId) {
        meetAll(asked);
        addAnswer([plan.focusId, ...asked]);
      }
      break;
    case "recall_result": {
      // The question the check interrupted has now been answered.
      const resumed = plan.returnToId ? [plan.returnToId, ...asked] : [];
      meetAll(resumed);

      // Only what this reply explained counts as explained. A passed check is
      // acknowledged, not re-taught, so the concept keeps its earlier explanation
      // for later re-teaching and grading, even if the question was about it too.
      // A failed check stays fuzzy even though it was just re-taught: being told
      // again is not remembering.
      const explained = [
        ...(plan.verdict === "fuzzy" ? [plan.nodeId] : []),
        ...resumed,
      ].filter((id) => plan.verdict === "fuzzy" || id !== plan.nodeId);
      if (explained.length > 0) addAnswer(explained);
      break;
    }
    case "revisit_resume":
      meetAll(asked);
      addAnswer([plan.nodeId, ...asked]);
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
      pending = {
        kind: "open",
        originalQuestion: plan.originalQuestion,
        topicLabels: plan.topicLabels,
      };
      break;
    case "wander":
      break;
  }

  return { ...trail, nodes: draft.nodes, traces: draft.traces, pending };
}

/** The concept a turn left off on, for the "you are here" marker. */
function planFocusId(plan: TurnPlan): string | null {
  switch (plan.kind) {
    case "start":
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
  nextSteps: string[],
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
    plan.kind === "gap" || plan.kind === "answer" || plan.kind === "start"
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
    nextSteps,
  };
}
