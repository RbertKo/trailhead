import { describe, expect, it } from "vitest";

import { readableChatError } from "./client";

describe("readableChatError", () => {
  it("shows the message from an API error body", () => {
    const body = JSON.stringify({
      error: { code: "api_key_missing", message: "Not configured." },
    });

    expect(readableChatError(new Error(body))).toBe("Not configured.");
  });

  it.each(["plain text failure", '{"other":"json"}'])(
    "keeps any other message as it is: %s",
    (message) => {
      expect(readableChatError(new Error(message))).toBe(message);
    },
  );
});
