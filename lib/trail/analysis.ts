import { z } from "zod";

/**
 * What Muse Spark returns for one learner turn. Every field is required and
 * nullable rather than optional, which is what strict structured output needs.
 * Length limits are enforced by the engine, not here: the schema is sent to the
 * API, and Meta documents only part of what its strict mode accepts.
 */
export const conceptSchema = z.object({
  label: z.string().describe("Short concept name, in the learner's language."),
  summary: z
    .string()
    .describe("One or two sentences on this concept, as the learner met it."),
  parentLabel: z
    .string()
    .nullable()
    .describe("A broader concept this falls under, from the map or this list."),
  childLabels: z
    .array(z.string())
    .describe("Concepts on the map that belong directly under this one."),
  prerequisites: z
    .array(z.string())
    .describe("Up to 3 direct prerequisites, most needed first."),
  blockingPrerequisite: z
    .string()
    .nullable()
    .describe(
      "The one prerequisite an explanation cannot work without, else null.",
    ),
});
export type ConceptAnalysis = z.infer<typeof conceptSchema>;

export const turnAnalysisSchema = z.object({
  moment: z
    .enum([
      "broad_wish",
      "start_learning",
      "question",
      "coming_back",
      "wrapping_up",
      "other",
    ])
    .describe("What the learner is doing in this message."),
  focusLabel: z
    .string()
    .nullable()
    .describe("The main concept of this message: a label from `concepts`."),
  concepts: z.array(conceptSchema),
  nextSteps: z
    .array(z.string())
    .describe(
      "Up to 3 concepts, in order, that would make good next stops for this learner.",
    ),
  imageDescription: z
    .string()
    .nullable()
    .describe("What the dropped image shows, in one sentence. Null if no image."),
  keyRegion: z
    .string()
    .nullable()
    .describe(
      "Short English noun phrase naming the image's key visual region, e.g. 'diagram' or 'code block'. Null if no image.",
    ),
  recallVerdict: z
    .enum(["solid", "fuzzy", "not_answered"])
    .nullable()
    .describe("The grade of a pending recall check. Null if there is none."),
  recallNote: z
    .string()
    .nullable()
    .describe("What the recall answer got right and what it missed."),
  revisitChoice: z
    .enum(["continue", "review", "other"])
    .nullable()
    .describe("The reply to a pending continue-or-review offer, else null."),
});
export type TurnAnalysis = z.infer<typeof turnAnalysisSchema>;
