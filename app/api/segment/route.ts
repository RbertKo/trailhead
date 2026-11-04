import { z } from "zod";

import { parseJsonBody, upstreamErrorResponse } from "@/lib/api/http";
import { segmentImage } from "@/lib/meta/segment";

// Stays under the 4.5 MB Vercel Function body limit, with room for a base64
// data URL of a roughly 3 MB image.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const bodySchema = z.object({
  imageUrl: z
    .string()
    .refine(
      (url) => url.startsWith("https://") || url.startsWith("data:image/"),
      "Must be an HTTPS or image data URL",
    ),
  concept: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  const body = await parseJsonBody(request, bodySchema, MAX_BODY_BYTES);
  if ("response" in body) return body.response;

  try {
    return Response.json({ objects: await segmentImage(body.data) });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}
