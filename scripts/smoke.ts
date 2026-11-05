// Checks the real Meta Model API with the code paths the app uses, then rehearses
// the demo against it:
//   npm run smoke
// It spends a little real money (about $0.10 per run). Run it before recording.
import { streamText } from "ai";

import { toApiError } from "@/lib/api/errors";
import { metaApiClient, metaTextModel, metaTextOptions } from "@/lib/meta/client";
import { getMetaConfig, MissingApiKeyError } from "@/lib/meta/config";
import { segmentImage } from "@/lib/meta/segment";
import { analyzeTurn, userMessage } from "@/lib/trail/analyze";
import {
  advanceTime,
  applyTurn,
  completeTurn,
  type TurnResult,
} from "@/lib/trail/engine";
import { replySystem } from "@/lib/trail/prompts";
import type { HistoryMessage, Locale } from "@/lib/trail/request";
import { EMPTY_TRAIL, type TrailState } from "@/lib/trail/types";

const DAY = 24 * 60 * 60 * 1000;

function context() {
  return { now: Date.now(), newId: () => crypto.randomUUID() };
}

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

async function checkStructuredOutput(): Promise<string> {
  const analysis = await analyzeTurn({
    trail: EMPTY_TRAIL,
    history: [],
    message: { text: "Explain backpropagation", image: null },
    locale: "en",
  });
  if (!analysis) throw new Error("No usable structured output");
  if (analysis.concepts.length === 0) throw new Error("No concepts returned");
  return JSON.stringify({
    moment: analysis.moment,
    focusLabel: analysis.focusLabel,
    concepts: analysis.concepts.map((concept) => concept.label),
    prerequisites: analysis.concepts[0].prerequisites,
    blocking: analysis.concepts[0].blockingPrerequisite,
    nextSteps: analysis.nextSteps,
  });
}

async function readReply(
  turn: TurnResult,
  history: HistoryMessage[],
  message: string,
  locale: Locale,
): Promise<{ text: string; chunks: number }> {
  let streamError: unknown;
  const result = streamText({
    model: metaTextModel(),
    system: replySystem(turn.plan, turn.trail, null, locale, turn.callout.nextSteps),
    messages: [
      ...history.map(({ role, text }) => ({ role, content: text })),
      userMessage(message),
    ],
    maxOutputTokens: 2048,
    providerOptions: metaTextOptions({ reasoningEffort: "low" }),
    onError: ({ error }) => {
      streamError = error;
    },
  });

  let chunks = 0;
  for await (const delta of result.textStream) {
    if (delta) chunks += 1;
  }
  if (streamError) throw streamError;
  const text = await result.text;
  if (!text.trim()) throw new Error("The reply was empty");
  // Anything else and the app won't count a reply as delivered, so a hole it
  // explains would never fill in.
  const finishReason = await result.finishReason;
  if (finishReason !== "stop") {
    throw new Error(`The reply finished with "${finishReason}", not "stop"`);
  }
  return { text: text.trim(), chunks };
}

async function checkReplyStream(): Promise<string> {
  const message = "What is gradient descent?";
  const turn = applyTurn(
    EMPTY_TRAIL,
    { text: message, imageId: null },
    null,
    context(),
  );
  const { text, chunks } = await readReply(turn, [], message, "en");
  return `${chunks} chunks: ${text.slice(0, 80)}…`;
}

let dropped: { id: string; url: string } | undefined;

// The image is only test input. The app itself never generates images.
async function checkDropReading(): Promise<string> {
  const generated = await metaApiClient().images.generate({
    model: "muse-image-1.0",
    prompt:
      "A simple whiteboard diagram of a neural network with three labelled layers",
    n: 1,
    response_format: "url",
  });
  const url = generated.data?.[0]?.url;
  if (!url) throw new Error("Muse Image returned no URL");

  const response = await fetch(url);
  const type = response.headers.get("content-type") ?? "image/webp";
  const bytes = Buffer.from(await response.arrayBuffer());
  dropped = {
    id: "smoke",
    url: `data:${type};base64,${bytes.toString("base64")}`,
  };

  const analysis = await analyzeTurn({
    trail: EMPTY_TRAIL,
    history: [],
    message: { text: "", image: dropped },
    locale: "en",
  });
  if (!analysis?.imageDescription) throw new Error("The image was not read");
  if (analysis.concepts.length === 0) throw new Error("Nothing to place");
  return JSON.stringify({
    imageDescription: analysis.imageDescription,
    keyRegion: analysis.keyRegion,
    concepts: analysis.concepts.map((concept) => concept.label),
  });
}

async function checkSegmentation(): Promise<string> {
  if (!dropped) throw new Error("Skipped: no image to segment");
  const objects = await segmentImage({
    imageUrl: dropped.url,
    concept: "diagram",
  });
  return `${objects.length} region(s) found. Zero is valid, and the app carries on without one.`;
}

const DEMO_SCRIPTS: Record<
  Locale,
  { wish: string; question: string; related: string; stumble: string }
> = {
  en: {
    wish: "I want to learn AI",
    question: "Explain backpropagation",
    related: "How do you train a CNN?",
    stumble: "Hmm... what was it? I can't really remember",
  },
  ko: {
    wish: "AI 공부하고 싶어",
    question: "역전파 설명해줘",
    related: "CNN은 어떻게 학습시켜?",
    stumble: "음... 뭐였더라. 잘 기억 안 나",
  },
};

const START_SCRIPTS: Record<
  Locale,
  {
    scope: string;
    noPreference: string;
    direct: string;
    justExplain: string;
    oldQuestion: string;
  }
> = {
  en: {
    scope: "I want to understand ML, DL and LLMs as a whole",
    noPreference: "I don't know",
    direct: "Teach me AI, starting with the big picture",
    justExplain: "Nothing else. Now explain the topics above",
    oldQuestion: "What are you most curious about?",
  },
  ko: {
    scope: "ML/DL/LLM 분야를 전체적으로 파보고 싶어",
    noPreference: "모르겠어",
    direct: "AI가 뭔지 큰 그림부터 알려줘",
    justExplain: "없어. 이제 위 주제로 알려줘",
    oldQuestion: "그 중에서 지금 제일 땡기는 건 뭐야?",
  },
};

/** Replays the opening with real replies, including a refusal to narrow it. */
async function checkLearningStart(locale: Locale): Promise<string> {
  const { wish } = DEMO_SCRIPTS[locale];
  const { scope, noPreference, direct, justExplain, oldQuestion } =
    START_SCRIPTS[locale];
  const read = async (trail: TrailState, history: HistoryMessage[], text: string) => {
    const analysis = await analyzeTurn({
      trail,
      history,
      message: { text, image: null },
      locale,
    });
    if (!analysis) throw new Error(`No usable reading for: ${text}`);
    return applyTurn(trail, { text, imageId: null }, analysis, context());
  };

  const opening = await read(EMPTY_TRAIL, [], wish);
  if (opening.plan.kind !== "open") {
    throw new Error("Expected one opening question");
  }
  const { text: openingReply } = await readReply(opening, [], wish, locale);
  const waiting = completeTurn(opening.trail, opening.plan, openingReply, context());
  const history: HistoryMessage[] = [
    { role: "user", text: wish },
    { role: "assistant", text: openingReply },
  ];
  // Existing chats have no stored opening yet. Recover the interest from the
  // old repeated questions too, so the fix works without resetting the session.
  const legacyHistory: HistoryMessage[] = [
    ...history,
    { role: "user", text: scope },
    { role: "assistant", text: oldQuestion },
    { role: "user", text: noPreference },
    { role: "assistant", text: oldQuestion },
  ];
  const scenarios = [
    { text: scope, trail: waiting, history },
    { text: noPreference, trail: waiting, history },
    { text: direct, trail: EMPTY_TRAIL, history: [] },
    { text: justExplain, trail: EMPTY_TRAIL, history: legacyHistory },
  ];

  const replies: string[] = [];
  for (const { text, trail, history: previous } of scenarios) {
    const turn = await read(trail, previous, text);
    if (turn.plan.kind !== "start") {
      throw new Error(`"${text}" produced ${turn.plan.kind}, expected start`);
    }
    const { text: reply } = await readReply(turn, previous, text, locale);
    if (/[?？]\s*$/.test(reply) || reply.length < 60) {
      throw new Error(`Expected an explanation without a final question: ${reply}`);
    }
    const explained = completeTurn(turn.trail, turn.plan, reply, context());
    if (!explained.nodes.some((node) => node.state === "seen")) {
      throw new Error("The delivered explanation did not reach the map");
    }
    if (explained.pending !== null || turn.callout.nextSteps.length > 0) {
      throw new Error("The introduction left a pending question or offered a path");
    }
    replies.push(`"${text}" -> start\n      ${reply.replace(/\n/g, " ")}`);
  }
  return replies.join("\n      ");
}

/** Runs the demo script through the same reading and engine the app uses. */
async function checkDemoScript(locale: Locale): Promise<string> {
  const { wish, question, related, stumble } = DEMO_SCRIPTS[locale];
  let trail: TrailState = EMPTY_TRAIL;
  const history: HistoryMessage[] = [];

  async function say(text: string) {
    const analysis = await analyzeTurn({
      trail,
      history,
      message: { text, image: null },
      locale,
    });
    if (!analysis) throw new Error(`No usable reading for: ${text}`);
    const turn = applyTurn(trail, { text, imageId: null }, analysis, context());
    trail = completeTurn(turn.trail, turn.plan, "(reply)", context());
    history.push({ role: "user", text }, { role: "assistant", text: "(reply)" });
    return turn;
  }

  const steps: string[] = [];
  const expect = (text: string, actual: string, ...wanted: string[]) => {
    steps.push(`"${text}" -> ${actual}`);
    if (!wanted.includes(actual)) {
      throw new Error(
        `Expected ${wanted.join(" or ")}.\n      So far:\n      ${steps.join("\n      ")}`,
      );
    }
  };

  expect(wish, (await say(wish)).plan.kind, "open");

  const gap = await say(question);
  expect(question, gap.plan.kind, "gap");
  steps.push(`  hole: ${gap.callout.nodeLabel}, back to: ${gap.callout.focusLabel}`);

  trail = advanceTime(trail, 7 * DAY, Date.now());
  steps.push("(7 days pass)");

  const recall = await say(related);
  expect(related, recall.plan.kind, "recall_ask");
  steps.push(`  testing: ${recall.callout.nodeLabel}`);

  const graded = await say(stumble);
  expect(stumble, graded.plan.kind, "recall_result");
  expect(stumble, graded.callout.verdict ?? "none", "fuzzy");

  return steps.join("\n      ");
}

const checks: [name: string, run: () => Promise<string>][] = [
  ["List models", checkModels],
  ["Muse Spark: structured output", checkStructuredOutput],
  ["Muse Spark: streaming reply", checkReplyStream],
  ["Muse Spark: reading a dropped image", checkDropReading],
  ["SAM 3.1: segmenting a dropped image", checkSegmentation],
  ["Demo script in English", () => checkDemoScript("en")],
  ["Demo script in Korean", () => checkDemoScript("ko")],
  ["Learning starts in English", () => checkLearningStart("en")],
  ["Learning starts in Korean", () => checkLearningStart("ko")],
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
      console.log(`FAIL  ${name}\n      ${toApiError(error).code}: ${raw}`);
    }
  }

  console.log(`\n${checks.length - failures}/${checks.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
