import "server-only";

import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import OpenAI from "openai";

import { getMetaConfig } from "./config";

/** AI SDK model for Muse Spark: structured output and streaming text. */
export function metaTextModel() {
  const { apiKey, baseURL, models } = getMetaConfig();
  return createOpenAI({ apiKey, baseURL }).responses(models.text);
}

/** OpenAI SDK client for what the AI SDK does not cover: SAM. */
export function metaApiClient() {
  const { apiKey, baseURL } = getMetaConfig();
  return new OpenAI({ apiKey, baseURL });
}

/**
 * Provider options for Muse Spark on the Responses API.
 *
 * - `forceReasoning`: the SDK does not recognise Muse model IDs as reasoning
 *   models and would otherwise drop the reasoning settings.
 * - `store: false`: Meta's recommended stateless mode. Nothing is kept on Meta's
 *   side between turns, and each turn sends the text history it needs.
 * - `reasoningSummary: null`: the SDK otherwise asks for a detailed summary of
 *   the reasoning, which nothing here shows.
 */
export function metaTextOptions(
  options: Pick<OpenAILanguageModelResponsesOptions, "reasoningEffort">,
) {
  return {
    openai: {
      forceReasoning: true,
      store: false,
      reasoningSummary: null,
      ...options,
    } satisfies OpenAILanguageModelResponsesOptions,
  };
}
