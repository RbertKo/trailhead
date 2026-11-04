import type { UIMessage } from "ai";

import type { HistoryMessage } from "./prompts";
import type { TrailState, TurnDataParts } from "./types";

export const MAX_HISTORY = 20;
export const MAX_HISTORY_TEXT = 4_000;
export const MAX_MESSAGE_TEXT = 8_000;

export type TrailUIMessage = UIMessage<
  { imageId?: string },
  TurnDataParts
>;

export interface TurnRequest {
  history: HistoryMessage[];
  message: { text: string; image: { id: string; url: string } | null };
  trail: TrailState;
}

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
  };
}
