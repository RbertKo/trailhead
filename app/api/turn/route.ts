import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type FinishReason,
} from "ai";
import { reportApiError } from "@/lib/api/errors";
import { parseJsonBody, upstreamErrorResponse } from "@/lib/api/http";
import { metaTextModel, metaTextOptions } from "@/lib/meta/client";
import { analyzeTurn, userMessage } from "@/lib/trail/analyze";
import { applyTurn, completeTurn } from "@/lib/trail/engine";
import { replySystem } from "@/lib/trail/prompts";
import { turnRequestSchema, type TrailUIMessage } from "@/lib/trail/request";

// Vercel functions take at most 4.5 MB, and the browser shrinks images to fit.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
// Reasoning tokens count toward this limit too.
const MAX_REPLY_TOKENS = 4096;
// The hole stays open after these. An unknown reason counts as delivered, because
// wrongly filling a hole costs less than a hole that can never be filled.
const CUT_OFF: FinishReason[] = [
  "error",
  "length",
  "content-filter",
  "interrupted",
];

export async function POST(request: Request) {
  const body = await parseJsonBody(request, turnRequestSchema, MAX_BODY_BYTES);
  if ("response" in body) return body.response;
  const { history, message, trail, locale } = body.data;

  // The reading comes first, so a bad key or missing billing is a plain HTTP
  // error and the map only changes once the turn is known to be going ahead.
  let analysis;
  try {
    analysis = await analyzeTurn(
      { trail, history, message, locale },
      request.signal,
    );
  } catch (error) {
    // The learner pressed Stop. That isn't a Meta API failure, so it isn't logged
    // as one, and there's nobody left to read a response.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return upstreamErrorResponse(error);
  }

  const newId = () => crypto.randomUUID();
  const turn = applyTurn(
    trail,
    { text: message.text, imageId: message.image?.id ?? null },
    analysis,
    { now: Date.now(), newId },
  );

  const stream = createUIMessageStream<TrailUIMessage>({
    onError: (error) => reportApiError(error).message,
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "data-trail", data: turn.trail, transient: true });
      writer.write({ type: "data-callout", data: turn.callout });

      const result = streamText({
        model: metaTextModel(),
        system: replySystem(
          turn.plan,
          turn.trail,
          turn.callout.imageDescription,
          locale,
          turn.callout.nextSteps,
        ),
        messages: [
          ...history.map(({ role, text }) => ({ role, content: text })),
          userMessage(message.text, message.image?.url),
        ],
        maxOutputTokens: MAX_REPLY_TOKENS,
        providerOptions: metaTextOptions({ reasoningEffort: "low" }),
        abortSignal: request.signal,
        onEnd: ({ text, finishReason }) => {
          // A hole only counts as filled once the explanation was really delivered.
          if (CUT_OFF.includes(finishReason) || !text.trim()) return;
          writer.write({
            type: "data-trail",
            data: completeTurn(turn.trail, turn.plan, text, {
              now: Date.now(),
              newId,
            }),
            transient: true,
          });
        },
      });

      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendStart: false,
          sendReasoning: false,
          onError: (error) => reportApiError(error).message,
        }),
      );
    },
  });

  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: consumeStream,
  });
}
