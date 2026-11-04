import "server-only";

import { metaApiClient } from "./client";
import { getMetaConfig } from "./config";

/**
 * Generates one image and returns a temporary signed URL. The URL form keeps
 * the response small: base64 images can exceed the 4.5 MB Vercel Function
 * response limit. Copy the image to storage if it has to outlive the URL.
 */
export async function generateImage(
  prompt: string,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  const { models } = getMetaConfig();
  const response = await metaApiClient().images.generate(
    {
      model: models.image,
      prompt,
      n: 1,
      response_format: "url",
    },
    { signal },
  );

  const url = response.data?.[0]?.url;
  if (!url) throw new Error("Muse Image returned no image URL");
  return { url };
}
