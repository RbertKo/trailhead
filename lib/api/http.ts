import type { z } from "zod";

import { reportApiError, type ApiError } from "./errors";

export function errorResponse({ status, code, message }: ApiError): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function upstreamErrorResponse(error: unknown): Response {
  return errorResponse(reportApiError(error));
}

/**
 * Reads and validates a JSON body. The size cap doubles as a cost cap: request
 * bodies become billed input tokens, so an unbounded body is an unbounded bill.
 */
export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maxBytes: number,
): Promise<{ data: z.output<Schema> } | { response: Response }> {
  const tooLarge = {
    response: errorResponse({
      status: 413,
      code: "payload_too_large",
      message: `The request body must be ${maxBytes} bytes or smaller.`,
    }),
  };

  if (Number(request.headers.get("content-length")) > maxBytes) return tooLarge;

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return tooLarge;

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return invalidBody();
  }

  const parsed = schema.safeParse(json);
  return parsed.success ? { data: parsed.data } : invalidBody();
}

export function invalidBody(): { response: Response } {
  return {
    response: errorResponse({
      status: 400,
      code: "invalid_request",
      message: "The request body is invalid.",
    }),
  };
}
