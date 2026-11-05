import { describe, expect, it } from "vitest";

import type { DroppedImage } from "./image";
import { buildTurnRequest, type TrailUIMessage } from "./request";
import {
  imagesToWrite,
  restoreSession,
  SESSION_VERSION,
  toStoredSession,
  type Session,
} from "./session";
import { EMPTY_TRAIL, type KnowledgeNode } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

const image: DroppedImage = {
  id: "image-1",
  url: "data:image/jpeg;base64,SECRETPIXELS",
  width: 10,
  height: 10,
  thumbnail: "data:image/jpeg;base64,THUMB",
};

const messages: TrailUIMessage[] = [
  {
    id: "m1",
    role: "user",
    metadata: { imageId: image.id },
    parts: [
      { type: "file", mediaType: "image/jpeg", url: image.url },
      { type: "text", text: "What is this?" },
    ],
  },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "A chain rule." }] },
];

const session: Session = {
  trail: EMPTY_TRAIL,
  messages,
  images: { [image.id]: image },
  regions: {},
  locale: "ko",
  elapsedDays: 7,
  savedAt: NOW,
};

function node(overrides: Partial<KnowledgeNode>): KnowledgeNode {
  return {
    id: "n1",
    label: "Chain rule",
    summary: "",
    state: "seen",
    parentId: null,
    prerequisiteIds: [],
    sources: [],
    firstSeenAt: NOW,
    lastTouchedAt: NOW,
    lastCheckedAt: null,
    lastPromptedAt: null,
    ...overrides,
  };
}

describe("saved sessions", () => {
  it("comes back the way it was saved", () => {
    expect(restoreSession(toStoredSession(session), [image], NOW)).toEqual(session);
  });

  it("keeps image data out of the session record", () => {
    expect(JSON.stringify(toStoredSession(session))).not.toContain("SECRETPIXELS");
  });

  it("shows on arrival what has faded while the learner was away", () => {
    const stored = toStoredSession({
      ...session,
      trail: {
        ...EMPTY_TRAIL,
        nodes: [node({ lastTouchedAt: NOW - 31 * DAY })],
      },
    });

    expect(restoreSession(stored, [], NOW)?.trail.nodes[0].state).toBe("fuzzy");
  });

  it("leaves out an image that is gone and can still build the next turn", () => {
    const restored = restoreSession(toStoredSession(session), [], NOW);

    expect(restored?.messages[0].parts).toEqual([
      { type: "text", text: "What is this?" },
    ]);
    const request = buildTurnRequest(
      [
        ...restored!.messages,
        { id: "m3", role: "user", parts: [{ type: "text", text: "Next" }] },
      ],
      restored!.trail,
      restored!.locale,
    );
    expect(request.history[0].text).toBe("What is this?");
  });

  it("drops a message that held nothing but a lost image", () => {
    const onlyImage: TrailUIMessage = {
      id: "m1",
      role: "user",
      metadata: { imageId: image.id },
      parts: [{ type: "file", mediaType: "image/jpeg", url: image.url }],
    };

    const restored = restoreSession(
      toStoredSession({ ...session, messages: [onlyImage] }),
      [],
      NOW,
    );

    expect(restored?.messages).toEqual([]);
  });

  it("skips a damaged image and keeps the rest", () => {
    const restored = restoreSession(
      toStoredSession(session),
      [image, { id: "broken", url: "not an image" }],
      NOW,
    );

    expect(Object.keys(restored?.images ?? {})).toEqual([image.id]);
  });

  it.each([
    ["nothing saved yet", undefined],
    ["another version", { ...toStoredSession(session), version: SESSION_VERSION + 1 }],
    ["a damaged trail", { ...toStoredSession(session), trail: { nodes: "broken" } }],
    ["damaged messages", { ...toStoredSession(session), messages: [{ id: 1 }] }],
  ])("starts a new trail from %s", (_name, record) => {
    expect(restoreSession(record, [image], NOW)).toBeNull();
  });
});

describe("which images a save writes", () => {
  const images = { [image.id]: image };

  it("writes an image that hasn't landed yet", () => {
    expect(imagesToWrite(images, new Set(), new WeakSet())).toEqual([image]);
  });

  it("skips an image that is already stored", () => {
    const committed = new WeakSet([image]);

    expect(imagesToWrite(images, new Set([image.id]), committed)).toEqual([]);
  });

  it("writes it again when another tab has erased the store", () => {
    const committed = new WeakSet([image]);

    expect(imagesToWrite(images, new Set(), committed)).toEqual([image]);
  });

  it("writes it again while an earlier write is still unconfirmed", () => {
    expect(imagesToWrite(images, new Set([image.id]), new WeakSet())).toEqual([image]);
  });

  it("writes the new version once SAM has cropped a thumbnail", () => {
    const committed = new WeakSet([image]);
    const cropped = { ...image, thumbnail: "data:image/jpeg;base64,CROPPED" };

    expect(
      imagesToWrite({ [image.id]: cropped }, new Set([image.id]), committed),
    ).toEqual([cropped]);
  });
});
