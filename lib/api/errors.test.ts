import { describe, expect, it } from "vitest";

import { MissingApiKeyError } from "@/lib/meta/config";

import { toApiError } from "./errors";

describe("toApiError", () => {
  it("reports a missing key as a server configuration problem", () => {
    expect(toApiError(new MissingApiKeyError())).toMatchObject({
      status: 503,
      code: "api_key_missing",
    });
  });

  it.each([
    [{ status: 401 }, "invalid_api_key", 502],
    [{ statusCode: 402 }, "billing_required", 502],
    [{ status: 404 }, "model_not_found", 502],
    [{ status: 429 }, "upstream_rate_limited", 429],
    [{ lastError: { statusCode: 403 } }, "model_forbidden", 502],
    [{ cause: { lastError: { status: 402 } } }, "billing_required", 502],
  ])("maps %j to %s", (error, code, status) => {
    expect(toApiError(error)).toMatchObject({ code, status });
  });

  it.each([[new Error("boom")], [{ status: 500 }], ["text"], [null]])(
    "falls back to a generic upstream error for %j",
    (error) => {
      expect(toApiError(error)).toMatchObject({
        status: 502,
        code: "upstream_error",
      });
    },
  );

  it("never repeats upstream text to clients", () => {
    const { message } = toApiError(new Error("leaked internal detail"));

    expect(message).not.toContain("leaked");
  });
});
