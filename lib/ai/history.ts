import { isToolUIPart, type UIMessage } from "ai";

type MessagePart = UIMessage["parts"][number];

function isContent(part: MessagePart): boolean {
  return part.type === "text" || isToolUIPart(part);
}

function isFinished(part: MessagePart): boolean {
  if (part.type === "reasoning") {
    // Reasoning is replayed in encrypted form only, and the encrypted content
    // arrives when the reasoning item ends.
    return part.providerMetadata?.openai?.reasoningEncryptedContent != null;
  }
  if (part.type === "text") return part.text.trim() !== "";
  if (isToolUIPart(part)) {
    return part.state === "output-available" || part.state === "output-error";
  }
  return true;
}

/**
 * Removes what a stopped or dropped stream leaves behind in the client's
 * history. Meta answers HTTP 400 to a tool call without a result, to reasoning
 * without encrypted content, and to reasoning with no answer or tool call after
 * it. Left in place, one stopped reply would make every later turn fail.
 */
export function toReplayableMessages<Message extends UIMessage>(
  messages: Message[],
): Message[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") return [message];

    const finished = message.parts.filter(isFinished);
    const lastContent = finished.findLastIndex(isContent);
    if (lastContent === -1) return [];

    const parts = finished.filter(
      (part, index) => part.type !== "reasoning" || index < lastContent,
    );
    return [{ ...message, parts }];
  });
}
