import { z } from "zod";

import { fadeStaleNodes } from "./engine";
import type { DroppedImage } from "./image";
import type { Locale, TrailUIMessage } from "./request";
import {
  droppedImageSchema,
  trailStateSchema,
  type DropRegion,
  type TrailState,
} from "./types";

/** Raise this when the stored shape changes. An older session is then left behind. */
export const SESSION_VERSION = 1;

/** What a learner should find again when they come back. */
export interface Session {
  trail: TrailState;
  messages: TrailUIMessage[];
  images: Record<string, DroppedImage>;
  regions: Record<string, DropRegion>;
  locale: Locale;
  elapsedDays: number;
  /** Lets a tab that sat open notice another tab has moved on since. */
  savedAt: number;
}

const storedSessionSchema = z.object({
  version: z.literal(SESSION_VERSION),
  savedAt: z.number(),
  trail: trailStateSchema,
  messages: z.array(
    z.looseObject({
      id: z.string(),
      role: z.enum(["system", "user", "assistant"]),
      parts: z.array(z.looseObject({ type: z.string() })),
    }),
  ),
  regions: z.record(
    z.string(),
    z.object({
      imageId: z.string(),
      concept: z.string(),
      bounds: z.object({
        left: z.number(),
        top: z.number(),
        right: z.number(),
        bottom: z.number(),
      }),
      maskPath: z.string(),
      maskWidth: z.number(),
      maskHeight: z.number(),
    }),
  ),
  locale: z.enum(["ko", "en"]),
  elapsedDays: z.number().nonnegative(),
});

const storedImageSchema = droppedImageSchema.extend({
  width: z.number(),
  height: z.number(),
  thumbnail: z.string(),
});

/**
 * Images are stored on their own, so saving a turn doesn't rewrite every image
 * the learner has ever thrown in. Messages keep only a reference to theirs.
 */
export function toStoredSession(session: Session) {
  return {
    version: SESSION_VERSION,
    savedAt: session.savedAt,
    trail: session.trail,
    regions: session.regions,
    locale: session.locale,
    elapsedDays: session.elapsedDays,
    messages: session.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) =>
        part.type === "file" ? { ...part, url: "" } : part,
      ),
    })),
  };
}

/**
 * New or changed images, and any the store no longer has: another tab may have
 * erased them, or an earlier save may have failed.
 */
export function imagesToWrite(
  images: Record<string, DroppedImage>,
  storedIds: Set<unknown>,
  committed: WeakSet<DroppedImage>,
): DroppedImage[] {
  return Object.values(images).filter(
    (image) => !committed.has(image) || !storedIds.has(image.id),
  );
}

function withImage(
  message: TrailUIMessage,
  images: Record<string, DroppedImage>,
): TrailUIMessage {
  const imageId = message.metadata?.imageId;
  const image = imageId ? images[imageId] : undefined;
  return {
    ...message,
    parts: message.parts
      .filter((part) => part.type !== "file" || image)
      .map((part) =>
        part.type === "file" && image ? { ...part, url: image.url } : part,
      ),
  };
}

/**
 * Returns null for anything that can't be trusted to be a session, so a damaged
 * or outdated record starts a new trail instead of breaking the page.
 */
export function restoreSession(
  record: unknown,
  storedImages: unknown[],
  now: number,
): Session | null {
  const stored = storedSessionSchema.safeParse(record);
  if (!stored.success) return null;

  const images = Object.fromEntries(
    storedImages.flatMap((value) => {
      const image = storedImageSchema.safeParse(value);
      return image.success ? [[image.data.id, image.data]] : [];
    }),
  ) as Record<string, DroppedImage>;

  const { savedAt, trail, messages, regions, locale, elapsedDays } = stored.data;
  return {
    savedAt,
    // Time really has passed since this was saved, so the map shows it on arrival.
    trail: fadeStaleNodes(trail, now),
    messages: (messages as unknown as TrailUIMessage[])
      .map((message) => withImage(message, images))
      .filter((message) => message.parts.length > 0),
    images,
    regions,
    locale,
    elapsedDays,
  };
}
