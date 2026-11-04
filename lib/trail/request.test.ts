import { describe, expect, it } from "vitest";

import {
  buildTurnRequest,
  MAX_HISTORY,
  MAX_HISTORY_TEXT,
  type TrailUIMessage,
} from "./request";
import { EMPTY_TRAIL, type TurnCallout } from "./types";

function user(text: string): TrailUIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistant(text: string, callout?: Partial<TurnCallout>): TrailUIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      ...(callout
        ? [
            {
              type: "data-callout" as const,
              data: {
                kind: "answer",
                nodeLabel: null,
                focusLabel: null,
                reason: null,
                verdict: null,
                placed: [],
                imageDescription: null,
                keyRegion: null,
                ...callout,
              } satisfies TurnCallout,
            },
          ]
        : []),
      { type: "text", text },
    ],
  };
}

function drop(url: string, imageId: string, text?: string): TrailUIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    metadata: { imageId },
    parts: [
      { type: "file", mediaType: "image/jpeg", url },
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
  };
}

const URL_A = "data:image/jpeg;base64,AAAA";

describe("buildTurnRequest", () => {
  it("sends the last message with its image, and the rest as history", () => {
    const body = buildTurnRequest(
      [user("first"), assistant("reply"), drop(URL_A, "img-1", "this?")],
      EMPTY_TRAIL,
      "ko",
    );
    expect(body.history).toEqual([
      { role: "user", text: "first" },
      { role: "assistant", text: "reply" },
    ]);
    expect(body.message).toEqual({
      text: "this?",
      image: { id: "img-1", url: URL_A },
    });
  });

  it("never resends an earlier image, only what was read from it", () => {
    const body = buildTurnRequest(
      [
        drop(URL_A, "img-1"),
        assistant("reply", { imageDescription: "A neuron diagram" }),
        user("next"),
      ],
      EMPTY_TRAIL,
      "ko",
    );
    expect(JSON.stringify(body)).not.toContain(URL_A);
    expect(body.history[0]).toEqual({
      role: "user",
      text: "[dropped an image: A neuron diagram]",
    });
    expect(body.message.image).toBeNull();
  });

  it("keeps a stopped drop readable when no description came back", () => {
    const body = buildTurnRequest(
      [drop(URL_A, "img-1", "look"), assistant(""), user("next")],
      EMPTY_TRAIL,
      "ko",
    );
    expect(body.history).toEqual([
      { role: "user", text: "look [dropped an image]" },
    ]);
  });

  it("drops empty assistant messages left by a stopped turn", () => {
    const body = buildTurnRequest(
      [user("first"), assistant(""), user("next")],
      EMPTY_TRAIL,
      "ko",
    );
    expect(body.history).toEqual([{ role: "user", text: "first" }]);
  });

  it("caps how much history is sent", () => {
    const many = Array.from({ length: MAX_HISTORY + 10 }, (_, index) =>
      user(`m${index}`),
    );
    const body = buildTurnRequest(
      [...many, user("x".repeat(10))],
      EMPTY_TRAIL,
      "ko",
    );
    expect(body.history).toHaveLength(MAX_HISTORY);
    expect(body.history.at(-1)?.text).toBe(`m${MAX_HISTORY + 9}`);

    const long = buildTurnRequest(
      [user("y".repeat(MAX_HISTORY_TEXT + 100)), user("next")],
      EMPTY_TRAIL,
      "ko",
    );
    expect(long.history[0].text).toHaveLength(MAX_HISTORY_TEXT);
  });

  it("carries the interface language", () => {
    expect(buildTurnRequest([user("hi")], EMPTY_TRAIL, "en").locale).toBe("en");
  });

  it("refuses an empty conversation", () => {
    expect(() => buildTurnRequest([], EMPTY_TRAIL, "ko")).toThrow();
  });
});
