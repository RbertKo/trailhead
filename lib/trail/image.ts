import type { DropRegion } from "./types";

/** A dropped image, kept only in the browser. */
export interface DroppedImage {
  id: string;
  /** Sent to the model once, with the turn it was dropped in. */
  url: string;
  width: number;
  height: number;
  /** Small version for the map. Replaced by the key region once SAM finds it. */
  thumbnail: string;
}

const MAX_SIDE = 1600;
const THUMBNAIL_SIDE = 160;
// The API route takes 4 MiB per request, and that also has to carry the trail and
// the recent conversation.
const MAX_DATA_URL = 2_500_000;
const MIN_REGION_SHARE = 0.03;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = source;
  });
}

/** `source` defaults to the whole image. */
function encode(
  image: HTMLImageElement,
  maxSide: number,
  quality: number,
  source = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight },
) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be processed.");
  // JPEG has no transparency, so a transparent diagram would turn black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return {
    url: canvas.toDataURL("image/jpeg", quality),
    width: canvas.width,
    height: canvas.height,
  };
}

/** Re-encodes any image the browser can read into a small JPEG, for the API. */
export async function prepareImage(file: File): Promise<DroppedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("The image has no size.");
    }

    let encoded = encode(image, MAX_SIDE, 0.85);
    for (let side = MAX_SIDE; encoded.url.length > MAX_DATA_URL; side *= 0.7) {
      encoded = encode(image, side * 0.7, 0.75);
    }

    return {
      id: crypto.randomUUID(),
      ...encoded,
      thumbnail: encode(image, THUMBNAIL_SIDE, 0.8).url,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** A speck is not "the key region": it is more likely a stray match. */
export function isUsefulRegion(
  dropped: Pick<DroppedImage, "width" | "height">,
  { bounds }: Pick<DropRegion, "bounds">,
): boolean {
  const regionArea = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
  return regionArea >= dropped.width * dropped.height * MIN_REGION_SHARE;
}

/** A small crop of the part SAM picked out. Falls back to null if it fails. */
export async function cropRegionThumbnail(
  dropped: DroppedImage,
  { bounds }: DropRegion,
): Promise<string | null> {
  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);
  const width = Math.min(dropped.width, bounds.right) - left;
  const height = Math.min(dropped.height, bounds.bottom) - top;
  if (width <= 0 || height <= 0) return null;

  try {
    const image = await loadImage(dropped.url);
    return encode(image, THUMBNAIL_SIDE, 0.8, { x: left, y: top, width, height })
      .url;
  } catch {
    return null;
  }
}
