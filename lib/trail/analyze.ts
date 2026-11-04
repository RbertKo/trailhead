import "server-only";

import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type ModelMessage,
} from "ai";

import { metaTextModel, metaTextOptions } from "@/lib/meta/client";
import { segmentImage } from "@/lib/meta/segment";

import { turnAnalysisSchema, type TurnAnalysis } from "./analysis";
import { ANALYZER_SYSTEM, analyzerInput } from "./prompts";
import type { HistoryMessage, IncomingMessage, Locale } from "./request";
import type { DropRegion, TrailState } from "./types";

// Reasoning tokens count toward this limit, so it has to leave room for the JSON.
const MAX_ANALYSIS_TOKENS = 4096;
const MAX_ATTEMPTS = 2;
const SEGMENT_TIMEOUT_MS = 12_000;

/** A user message for the Responses API, with its image if there is one. */
export function userMessage(text: string, imageUrl?: string): ModelMessage {
  if (!imageUrl) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      { type: "file", mediaType: "image", data: imageUrl },
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
  };
}

/**
 * Reads one learner turn with Muse Spark's structured output. Returns null when
 * the output is unusable, so a bad reading never costs the learner their reply.
 * Anything else (a bad key, no billing, rate limits) still throws, because the
 * reply would fail the same way.
 */
export async function analyzeTurn(
  input: {
    trail: TrailState;
    history: HistoryMessage[];
    message: IncomingMessage;
    locale: Locale;
  },
  signal?: AbortSignal,
): Promise<TurnAnalysis | null> {
  const { trail, history, message, locale } = input;
  const text = analyzerInput(
    trail,
    history,
    { text: message.text, hasImage: message.image !== null },
    locale,
  );

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { output } = await generateText({
        model: metaTextModel(),
        system: ANALYZER_SYSTEM,
        messages: [userMessage(text, message.image?.url)],
        output: Output.object({ schema: turnAnalysisSchema }),
        maxOutputTokens: MAX_ANALYSIS_TOKENS,
        // `strict` only adds a check of the schema itself. Meta constrains the
        // output to the schema either way, so it would only add a way to fail.
        providerOptions: {
          openai: {
            ...metaTextOptions({ reasoningEffort: "low" }).openai,
            strictJsonSchema: false,
          },
        },
        abortSignal: signal,
      });
      return output;
    } catch (error) {
      // Invalid JSON, or no text at all, such as when reasoning used up the limit.
      const isUnusable =
        NoObjectGeneratedError.isInstance(error) ||
        NoOutputGeneratedError.isInstance(error);
      if (!isUnusable) throw error;
      console.error(
        `[trail] unusable analysis, attempt ${attempt}: ${error.message}`,
      );
    }
  }
  return null;
}

/**
 * Picks out the key region of a dropped image with SAM 3.1, so the map can show
 * the part that matters rather than the whole screenshot. It is an enhancement:
 * any failure is logged and the turn carries on without a region.
 */
export async function segmentKeyRegion(
  image: { id: string; url: string },
  concept: string,
  signal: AbortSignal,
): Promise<DropRegion | null> {
  try {
    const objects = await segmentImage(
      { imageUrl: image.url, concept },
      AbortSignal.any([signal, AbortSignal.timeout(SEGMENT_TIMEOUT_MS)]),
    );
    const area = ({ bounds: b }: (typeof objects)[number]) =>
      (b.right - b.left) * (b.bottom - b.top);
    const largest = objects.reduce<(typeof objects)[number] | null>(
      (best, object) => (!best || area(object) > area(best) ? object : best),
      null,
    );
    if (!largest) return null;

    return {
      imageId: image.id,
      concept,
      bounds: largest.bounds,
      maskPath: largest.maskPath,
      maskWidth: largest.maskWidth,
      maskHeight: largest.maskHeight,
    };
  } catch (error) {
    if (!signal.aborted) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[trail] segmentation skipped: ${detail}`);
    }
    return null;
  }
}
