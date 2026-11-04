// Checks the real Meta Model API with the code paths the app uses:
//   npm run smoke
// It spends a little real money (about $0.02 per run). It covers the key, the
// billing setup, regional model availability and the AI SDK reasoning replay.
import { isStepCount, streamText } from "ai";

import { chatTools } from "@/lib/ai/tools";
import { toApiError } from "@/lib/api/errors";
import {
  metaApiClient,
  metaTextModel,
  metaTextOptions,
} from "@/lib/meta/client";
import { getMetaConfig, MissingApiKeyError } from "@/lib/meta/config";
import { generateImage } from "@/lib/meta/image";
import { segmentImage } from "@/lib/meta/segment";

async function checkModels(): Promise<string> {
  const { models } = getMetaConfig();
  const { data } = await metaApiClient().models.list();
  const available = new Set(data.map((model) => model.id));
  const missing = Object.values(models).filter((id) => !available.has(id));
  if (missing.length > 0) {
    throw new Error(`Not available to this account: ${missing.join(", ")}`);
  }
  return `${available.size} models available, configured models present`;
}

// The second step sends the encrypted reasoning and tool output back, which is
// the part of the AI SDK integration that Meta's docs do not show directly.
async function checkTextAndTools(): Promise<string> {
  let streamError: unknown;
  const result = streamText({
    model: metaTextModel(),
    prompt:
      "What time is it in Asia/Seoul right now? Call the tool, then answer in one short sentence.",
    tools: chatTools,
    stopWhen: isStepCount(3),
    maxOutputTokens: 1024,
    providerOptions: metaTextOptions({ reasoningEffort: "low" }),
    onError: ({ error }) => {
      streamError = error;
    },
  });

  const [text, steps] = await Promise.all([result.text, result.steps]).catch(
    (error) => {
      throw streamError ?? error;
    },
  );
  if (streamError) throw streamError;

  const toolCalls = steps.flatMap((step) => step.toolCalls).length;
  if (toolCalls === 0) throw new Error("The model did not call the tool");
  if (!text.trim()) throw new Error("No text after the tool result");
  return `${steps.length} steps, ${toolCalls} tool call(s): ${text.trim()}`;
}

let generatedImageUrl: string | undefined;

async function checkImage(): Promise<string> {
  const { url } = await generateImage(
    "A single red apple on a plain white table",
  );
  generatedImageUrl = url;
  return "image generated";
}

async function checkSegment(): Promise<string> {
  if (!generatedImageUrl) throw new Error("Skipped: no image to segment");
  const objects = await segmentImage({
    imageUrl: generatedImageUrl,
    concept: "apple",
  });
  return `${objects.length} object(s) segmented`;
}

const checks: [name: string, run: () => Promise<string>][] = [
  ["List models", checkModels],
  ["Muse Spark: streaming + tool loop", checkTextAndTools],
  ["Muse Image: generate", checkImage],
  ["SAM 3.1: segment", checkSegment],
];

async function main() {
  try {
    const { baseURL, models } = getMetaConfig();
    console.log(`Base URL: ${baseURL}`);
    console.log(`Models:   ${Object.values(models).join(", ")}\n`);
  } catch (error) {
    if (!(error instanceof MissingApiKeyError)) throw error;
    console.error("MODEL_API_KEY is not set. Add it to .env.local.");
    process.exit(1);
  }

  let failures = 0;
  for (const [name, run] of checks) {
    const startedAt = Date.now();
    try {
      const detail = await run();
      console.log(`PASS  ${name} (${Date.now() - startedAt} ms)\n      ${detail}`);
    } catch (error) {
      failures += 1;
      const raw = error instanceof Error ? error.message : String(error);
      console.log(
        `FAIL  ${name}\n      ${toApiError(error).code}: ${raw}`,
      );
    }
  }

  console.log(`\n${checks.length - failures}/${checks.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
