import { z } from "zod";

import { parseJsonBody, upstreamErrorResponse } from "@/lib/api/http";
import { generateImage } from "@/lib/meta/image";

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
});

export async function POST(request: Request) {
  const body = await parseJsonBody(request, bodySchema, 8 * 1024);
  if ("response" in body) return body.response;

  try {
    return Response.json(await generateImage(body.data.prompt));
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}
