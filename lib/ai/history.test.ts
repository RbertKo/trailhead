import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { toReplayableMessages } from "./history";

type Part = UIMessage["parts"][number];

const finishedReasoning: Part = {
  type: "reasoning",
  text: "summary",
  state: "done",
  providerMetadata: { openai: { reasoningEncryptedContent: "ENC" } },
};
const unfinishedReasoning: Part = {
  type: "reasoning",
  text: "partial",
  state: "streaming",
  providerMetadata: { openai: { reasoningEncryptedContent: null } },
};
const text: Part = { type: "text", text: "An answer", state: "done" };
const toolWithResult = {
  type: "tool-getCurrentTime",
  toolCallId: "call_1",
  state: "output-available",
  input: {},
  output: {},
} as Part;
const toolWithoutResult = {
  type: "tool-getCurrentTime",
  toolCallId: "call_2",
  state: "input-available",
  input: {},
} as Part;

function assistant(...parts: Part[]): UIMessage {
  return { id: "a", role: "assistant", parts };
}

function partsAfterCleanup(...parts: Part[]) {
  return toReplayableMessages([assistant(...parts)])[0]?.parts;
}

describe("toReplayableMessages", () => {
  it("keeps a finished reply unchanged", () => {
    const parts: Part[] = [
      { type: "step-start" },
      finishedReasoning,
      toolWithResult,
      { type: "step-start" },
      finishedReasoning,
      text,
    ];

    expect(partsAfterCleanup(...parts)).toEqual(parts);
  });

  it("leaves user messages alone", () => {
    const user: UIMessage = {
      id: "u",
      role: "user",
      parts: [{ type: "text", text: " " }],
    };

    expect(toReplayableMessages([user])).toEqual([user]);
  });

  it("drops a tool call without a result, along with the reasoning before it", () => {
    expect(
      partsAfterCleanup(finishedReasoning, toolWithoutResult),
    ).toBeUndefined();
  });

  it("keeps a finished step and drops the unfinished one after it", () => {
    expect(
      partsAfterCleanup(
        finishedReasoning,
        toolWithResult,
        { type: "step-start" },
        finishedReasoning,
      ),
    ).toEqual([finishedReasoning, toolWithResult, { type: "step-start" }]);
  });

  it("drops reasoning that has no encrypted content", () => {
    expect(partsAfterCleanup(unfinishedReasoning, text)).toEqual([text]);
  });

  it("removes a message left with reasoning only", () => {
    expect(partsAfterCleanup(finishedReasoning)).toBeUndefined();
  });

  it("removes a message whose text is still blank", () => {
    expect(
      partsAfterCleanup({ type: "text", text: "  ", state: "streaming" }),
    ).toBeUndefined();
  });

  it("keeps partial text from a stopped reply", () => {
    const partial: Part = { type: "text", text: "Half an", state: "streaming" };

    expect(partsAfterCleanup(partial)).toEqual([partial]);
  });
});
