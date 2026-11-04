import "server-only";

import { parseImageStream } from "@meta-sam/parser";
import type { ResponseInputImage } from "openai/resources/responses/responses";

import { metaApiClient } from "./client";
import { getMetaConfig } from "./config";
import { toSegmentedObjects, type SegmentedObject } from "./segment-result";

/**
 * Segments every match of a short noun phrase in one image.
 * `imageUrl` is an HTTPS URL or a `data:image/...` URL.
 */
export async function segmentImage(input: {
  imageUrl: string;
  concept: string;
}): Promise<SegmentedObject[]> {
  const { models } = getMetaConfig();
  const events = await metaApiClient().responses.create({
    model: models.segment,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: input.concept },
          // Meta's SAM requests have no `detail`, which the SDK's types require.
          {
            type: "input_image",
            image_url: input.imageUrl,
          } as ResponseInputImage,
        ],
      },
    ],
    stream: true,
  });

  return toSegmentedObjects(await parseImageStream(events).finalResult);
}
