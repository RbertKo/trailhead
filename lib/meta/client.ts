import "server-only";

import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import OpenAI from "openai";

import { getMetaConfig } from "./config";

/** AI SDK model for streaming text, tool loops and agents. */
export function metaTextModel() {
  const { apiKey, baseURL, models } = getMetaConfig();
  return createOpenAI({ apiKey, baseURL }).responses(models.text);
}

/** OpenAI SDK client for what the AI SDK does not cover: Muse Image and SAM. */
export function metaApiClient() {
  const { apiKey, baseURL } = getMetaConfig();
  return new OpenAI({ apiKey, baseURL });
}

/**
 * Provider options for Muse Spark on the Responses API.
 *
 * - `forceReasoning`: the SDK does not recognise Muse model IDs as reasoning
 *   models and would otherwise drop the reasoning settings.
 * - `store: false`: Meta's recommended stateless mode. The SDK then requests
 *   `reasoning.encrypted_content` and replays it on the next turn, so reasoning
 *   survives across turns without any server-side conversation state.
 */
export function metaTextOptions(
  overrides: Pick<OpenAILanguageModelResponsesOptions, "reasoningEffort"> = {},
) {
  return {
    openai: {
      forceReasoning: true,
      store: false,
      reasoningEffort: "medium",
      reasoningSummary: "auto",
      ...overrides,
    } satisfies OpenAILanguageModelResponsesOptions,
  };
}
