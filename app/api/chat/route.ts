import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";
import { z } from "zod";

import { toReplayableMessages } from "@/lib/ai/history";
import { chatTools, type ChatUIMessage } from "@/lib/ai/tools";
import { reportApiError } from "@/lib/api/errors";
import {
  errorResponse,
  invalidBody,
  parseJsonBody,
  upstreamErrorResponse,
} from "@/lib/api/http";
import { metaTextModel, metaTextOptions } from "@/lib/meta/client";

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES = 50;
const MAX_STEPS = 5;
// Covers reasoning and visible output together, so it cannot be set too low.
const MAX_OUTPUT_TOKENS = 4096;

// Clients send the conversation so far. They must not be able to add system
// instructions to it.
const bodySchema = z.object({
  messages: z
    .array(z.looseObject({ role: z.enum(["user", "assistant"]) }))
    .min(1),
});

export async function POST(request: Request) {
  const body = await parseJsonBody(request, bodySchema, MAX_BODY_BYTES);
  if ("response" in body) return body.response;

  if (body.data.messages.length > MAX_MESSAGES) {
    return errorResponse({
      status: 413,
      code: "conversation_too_long",
      message: "This conversation is too long. Start a new one.",
    });
  }

  let messages: ChatUIMessage[];
  try {
    messages = await validateUIMessages<ChatUIMessage>({
      messages: body.data.messages,
      tools: chatTools,
    });
  } catch {
    return invalidBody().response;
  }

  try {
    const result = streamText({
      model: metaTextModel(),
      messages: await convertToModelMessages(toReplayableMessages(messages), {
        tools: chatTools,
      }),
      tools: chatTools,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: metaTextOptions(),
      // Stops the model, and the billing, when the client disconnects or stops.
      abortSignal: request.signal,
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        // Needed for reasoning replay: the encrypted reasoning travels through
        // the client and comes back with the next turn's messages.
        sendReasoning: true,
        onError: (error) => reportApiError(error).message,
      }),
      consumeSseStream: consumeStream,
    });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}
