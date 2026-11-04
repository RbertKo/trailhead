import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJsonBody } from "./http";

const schema = z.object({ prompt: z.string().min(1) });

function post(body: string, headers?: Record<string, string>) {
  return new Request("http://localhost/api", {
    method: "POST",
    body,
    headers,
  });
}

describe("parseJsonBody", () => {
  it("returns the validated data", async () => {
    const result = await parseJsonBody(
      post('{"prompt":"hello"}'),
      schema,
      1024,
    );

    expect(result).toEqual({ data: { prompt: "hello" } });
  });

  it.each(["not json", '{"prompt":""}', "{}"])(
    "rejects an invalid body with 400: %s",
    async (body) => {
      const result = await parseJsonBody(post(body), schema, 1024);

      expect("response" in result && result.response.status).toBe(400);
    },
  );

  it("rejects a body over the limit, counting bytes rather than characters", async () => {
    const result = await parseJsonBody(
      post('{"prompt":"가나다"}'),
      schema,
      16,
    );

    expect("response" in result && result.response.status).toBe(413);
  });

  it("rejects early from a declared content length", async () => {
    const result = await parseJsonBody(
      post('{"prompt":"hello"}', { "content-length": "999999" }),
      schema,
      1024,
    );

    expect("response" in result && result.response.status).toBe(413);
  });
});
