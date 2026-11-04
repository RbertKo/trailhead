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
export const MAX_NODES = 200;
export const MAX_TRACES = 500;
const MAX_LABEL = 120;
const MAX_SUMMARY = 1_000;
const MAX_TRACE_CONTENT = 2_000;
const MAX_ID = 64;

const id = z.string().min(1).max(MAX_ID);
const time = z.number().nonnegative();

export const knowledgeNodeSchema = z.object({
  id,
  label: z.string().min(1).max(MAX_LABEL),
  summary: z.string().max(MAX_SUMMARY),
  state: z.enum(NODE_STATES),
  parentId: id.nullable(),
  prerequisiteIds: z.array(id).max(MAX_NODES),
  sources: z.array(id).max(MAX_TRACES),
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
});
export type TrailState = z.infer<typeof trailStateSchema>;

export const EMPTY_TRAIL: TrailState = {
  nodes: [],
  traces: [],
  pending: null,
  focusId: null,
};

/** What this turn does. Decided by the engine, carried out by the reply model. */
export type TurnPlan =
  /** A broad wish: no curriculum, only "what are you most curious about?". */
  | { kind: "open" }
  | { kind: "answer"; focusId: string | null }
  /** Fill exactly one missing prerequisite, then return to the question. */
  | {
      kind: "gap";
      focusId: string;
      gapId: string;
      reason: "never_seen" | "fuzzy";
    }
  /** Test memory before saying anything about the concept. */
  | { kind: "recall_ask"; nodeId: string }
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
  | { kind: "revisit_offer"; nodeId: string }
  | {
      kind: "revisit_resume";
      nodeId: string;
      choice: "continue" | "review";
      originalQuestion: string;
    }
  /** Looking around for what's next: never answer with a list of topics. */
  | { kind: "wander"; holeId: string | null };

/** Shown in the conversation. Labels are resolved so messages stay readable. */
export interface TurnCallout {
  kind: TurnPlan["kind"];
  nodeLabel: string | null;
  focusLabel: string | null;
  reason: "never_seen" | "fuzzy" | null;
  verdict: "solid" | "fuzzy" | null;
  /** Concepts this turn added or touched, for "placed on the map" feedback. */
  placed: { label: string; isNew: boolean }[];
  /** Muse Spark's reading of a dropped image. */
  imageDescription: string | null;
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
  region: DropRegion;
};
