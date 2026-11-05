import { z } from "zod";

/**
 * - `seen`: looked at, memory not tested yet. Seeing is not knowing.
 * - `solid`: answered a recall check correctly.
 * - `fuzzy`: failed a recall check, or untouched for so long it has faded.
 * - `unseen`: referenced as a prerequisite but never looked at. A hole.
 */
export const NODE_STATES = ["solid", "seen", "fuzzy", "unseen"] as const;
export type NodeState = (typeof NODE_STATES)[number];

// The browser holds the trail and sends it with each turn, so these limits are
// what keep a turn's prompt, and therefore its cost, bounded.
export const MAX_NODES = 150;
export const MAX_TRACES = 300;
export const MAX_LABEL = 120;
export const MAX_SUMMARY = 1_000;
export const MAX_TRACE_CONTENT = 2_000;
/** A much-visited concept can't grow forever: all of this is resent every turn. */
export const MAX_NODE_SOURCES = 20;
export const MAX_NODE_PREREQUISITES = 8;
const MAX_ID = 64;

const id = z.string().min(1).max(MAX_ID);
const time = z.number().nonnegative();

export const knowledgeNodeSchema = z.object({
  id,
  label: z.string().min(1).max(MAX_LABEL),
  summary: z.string().max(MAX_SUMMARY),
  state: z.enum(NODE_STATES),
  parentId: id.nullable(),
  prerequisiteIds: z.array(id).max(MAX_NODE_PREREQUISITES),
  sources: z.array(id).max(MAX_NODE_SOURCES),
  firstSeenAt: time,
  lastTouchedAt: time,
  lastCheckedAt: time.nullable(),
  /** When a recall check was last offered, so an ignored one is not repeated. */
  lastPromptedAt: time.nullable(),
});
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;

export const traceSchema = z.object({
  id,
  /**
   * - `question`, `drop`: the learner asked something or threw an image in.
   * - `answer`: what the learner was told, kept so it can be re-taught later.
   * - `recall_check`: the learner's reply to a recall check, with the verdict.
   */
  type: z.enum(["question", "drop", "answer", "recall_check"]),
  content: z.string().max(MAX_TRACE_CONTENT),
  nodeIds: z.array(id).max(MAX_NODES),
  createdAt: time,
  /** Set on `drop`. The image itself stays in the browser. */
  imageId: id.nullable(),
  /** Set on `recall_check`. */
  verdict: z.enum(["solid", "fuzzy"]).nullable(),
});
export type Trace = z.infer<typeof traceSchema>;

const originalQuestion = z.string().max(MAX_TRACE_CONTENT);

/** A question the assistant asked and is waiting on, carried to the next turn. */
export const pendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open"),
    /** Their broad interest, kept even when recent chat history moves on. */
    originalQuestion,
    topicLabels: z.array(z.string().min(1).max(MAX_LABEL)).max(3),
  }),
  z.object({
    kind: z.literal("recall"),
    nodeId: id,
    /** What the learner was asking when the check interrupted, to return to. */
    originalQuestion,
    returnToId: id.nullable(),
  }),
  z.object({
    kind: z.literal("revisit"),
    nodeId: id,
    originalQuestion,
  }),
]);
export type Pending = z.infer<typeof pendingSchema>;

export const trailStateSchema = z.object({
  nodes: z.array(knowledgeNodeSchema).max(MAX_NODES),
  traces: z.array(traceSchema).max(MAX_TRACES),
  pending: pendingSchema.nullable(),
  /** The concept the conversation is on: "you are here" on the map. */
  focusId: id.nullable(),
  /** Questions asked since a path was last offered. */
  questionsSinceOffer: z.number().int().nonnegative(),
});
export type TrailState = z.infer<typeof trailStateSchema>;

/** What SAM 3.1 is asked to find: a short noun phrase. */
export const MAX_REGION_CONCEPT = 100;

/** Both the browser's encoder and Meta's API handle these formats. */
export const droppedImageSchema = z.object({
  id,
  url: z.string().regex(/^data:image\/(jpeg|png|webp|gif);base64,/),
});

export const EMPTY_TRAIL: TrailState = {
  nodes: [],
  traces: [],
  pending: null,
  focusId: null,
  questionsSinceOffer: 0,
};

/** What this turn does. Decided by the engine, carried out by the reply model. */
export type TurnPlan =
  /** One optional clarification of a broad wish, recorded after delivery. */
  | { kind: "open"; originalQuestion: string; topicLabels: string[] }
  /** Begin with the named interest, without another preference question. */
  | { kind: "start"; focusId: string | null; topicLabels: string[] }
  | { kind: "answer"; focusId: string | null }
  /** Fill exactly one missing prerequisite, then return to the question. */
  | {
      kind: "gap";
      focusId: string;
      gapId: string;
      reason: "never_seen" | "fuzzy";
    }
  /** Test memory before saying anything about the concept. */
  | {
      kind: "recall_ask";
      nodeId: string;
      originalQuestion: string;
      returnToId: string | null;
    }
  | {
      kind: "recall_result";
      nodeId: string;
      verdict: "solid" | "fuzzy";
      /** What the answer got right and what it missed. */
      note: string;
      originalQuestion: string;
      returnToId: string | null;
    }
  /** The learner came back to something: "continue, or review?". */
  | { kind: "revisit_offer"; nodeId: string; originalQuestion: string }
  | {
      kind: "revisit_resume";
      nodeId: string;
      choice: "continue" | "review";
      originalQuestion: string;
    }
  /** Looking for what's next: offer a short path built from where they've been. */
  | { kind: "wander"; holeId: string | null; steps: string[] };

/** Shown in the conversation. Labels are resolved so messages stay readable. */
export interface TurnCallout {
  kind: TurnPlan["kind"];
  nodeLabel: string | null;
  focusLabel: string | null;
  reason: "never_seen" | "fuzzy" | null;
  verdict: "solid" | "fuzzy" | null;
  /** Labels of the concepts this turn placed on the map. */
  placed: string[];
  /** Muse Spark's reading of a dropped image. */
  imageDescription: string | null;
  /** What SAM 3.1 should look for in a dropped image. */
  keyRegion: string | null;
  /** A short path offered as buttons after this reply. They can be ignored. */
  nextSteps: string[];
}

/** The part of a dropped image SAM 3.1 picked out, in the image's own pixels. */
export interface DropRegion {
  imageId: string;
  concept: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  maskPath: string;
  maskWidth: number;
  maskHeight: number;
}

/** Custom parts of the streamed message. `trail` is transient: state, not history. */
export type TurnDataParts = {
  trail: TrailState;
  callout: TurnCallout;
};
