import { z } from "zod";

import { parseJsonBody } from "@/lib/api/http";
import { segmentKeyRegion } from "@/lib/trail/analyze";
import { droppedImageSchema, MAX_REGION_CONCEPT } from "@/lib/trail/types";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const bodySchema = z.object({
  image: droppedImageSchema,
  concept: z.string().trim().min(1).max(MAX_REGION_CONCEPT),
});

/**
 * Picks out the key region of a dropped image. It is not part of the turn, so a
 * slow search never holds up the reply or the learner's next message.
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request, bodySchema, MAX_BODY_BYTES);
  if ("response" in body) return body.response;

  const region = await segmentKeyRegion(
    body.data.image,
    body.data.concept,
    request.signal,
  );
  return Response.json({ region });
}
