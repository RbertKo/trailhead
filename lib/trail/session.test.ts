import { describe, expect, it } from "vitest";

import type { DroppedImage } from "./image";
import { buildTurnRequest, type TrailUIMessage } from "./request";
import { restoreSession, SESSION_VERSION, toStoredSession } from "./session";
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

const session = {
  trail: EMPTY_TRAIL,
  messages,
  regions: {},
  locale: "ko" as const,
  elapsedDays: 7,
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
    const restored = restoreSession(toStoredSession(session), [image], NOW);

    expect(restored).toEqual({
      ...session,
      images: { [image.id]: image },
    });
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
      [...restored!.messages, { id: "m3", role: "user", parts: [{ type: "text", text: "Next" }] }],
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
