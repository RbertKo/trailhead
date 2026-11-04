import type { UIMessage } from "ai";
import { z } from "zod";

import {
  droppedImageSchema,
  trailStateSchema,
  type TrailState,
  type TurnDataParts,
} from "./types";

export const MAX_HISTORY = 20;
export const MAX_HISTORY_TEXT = 4_000;
export const MAX_MESSAGE_TEXT = 8_000;

/** The body of one turn: what the browser sends and the API route validates. */
export const turnRequestSchema = z.object({
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(MAX_HISTORY_TEXT),
      }),
    )
    .max(MAX_HISTORY),
  message: z
    .object({
      text: z.string().max(MAX_MESSAGE_TEXT),
      image: droppedImageSchema.nullable(),
    })
    .refine(({ text, image }) => text.trim() !== "" || image !== null),
  trail: trailStateSchema,
  locale: z.enum(["ko", "en"]),
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type HistoryMessage = TurnRequest["history"][number];
export type IncomingMessage = TurnRequest["message"];
export type Locale = TurnRequest["locale"];

export type TrailUIMessage = UIMessage<
  { imageId?: string },
  TurnDataParts
>;

export function messageText(message: TrailUIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
}

export function messageImageUrl(message: TrailUIMessage): string | null {
  const file = message.parts.find((part) => part.type === "file");
  return file?.type === "file" ? file.url : null;
}

export function messageCallout(message: TrailUIMessage) {
  const part = message.parts.find((candidate) => candidate.type === "data-callout");
  return part?.type === "data-callout" ? part.data : null;
}

/**
 * A dropped image is sent once, with its own turn. Later turns carry only what
 * the model read from it, so the request stays small however long the session.
 */
function historyText(message: TrailUIMessage, next: TrailUIMessage | undefined) {
  const text = messageText(message);
  if (!messageImageUrl(message)) return text;

  const description = next ? messageCallout(next)?.imageDescription : null;
  const note = `[dropped an image${description ? `: ${description}` : ""}]`;
  return text ? `${text} ${note}` : note;
}

/** Turns the chat's messages and the trail into the body of one turn. */
export function buildTurnRequest(
  messages: TrailUIMessage[],
  trail: TrailState,
  locale: Locale,
): TurnRequest {
  const last = messages.at(-1);
  if (!last) throw new Error("A turn needs a message");

  const history = messages
    .slice(0, -1)
    .flatMap<HistoryMessage>((message, index) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = historyText(message, messages[index + 1]);
      return text
        ? [{ role: message.role, text: text.slice(0, MAX_HISTORY_TEXT) }]
        : [];
    })
    .slice(-MAX_HISTORY);

  const imageUrl = messageImageUrl(last);
  return {
    history,
    message: {
      text: messageText(last),
      image:
        imageUrl && last.metadata?.imageId
          ? { id: last.metadata.imageId, url: imageUrl }
          : null,
    },
    trail,
    locale,
  };
}
