import { describe, expect, it } from "vitest";

import { curvePath, layoutTrail, stopShort, walkedSegments } from "./layout";
import {
  EMPTY_TRAIL,
  type KnowledgeNode,
  type NodeState,
  type Trace,
  type TrailState,
} from "./types";

function node(id: string, state: NodeState = "seen"): KnowledgeNode {
  return {
    id,
    label: id,
    summary: "",
    state,
    parentId: null,
    prerequisiteIds: [],
    sources: [],
    firstSeenAt: 0,
    lastTouchedAt: 0,
    lastCheckedAt: null,
    lastPromptedAt: null,
  };
}

function trace(nodeIds: string[]): Trace {
  return {
    id: nodeIds.join("-"),
    type: "question",
    content: "",
    nodeIds,
    createdAt: 0,
    imageId: null,
    verdict: null,
  };
}

function trail(nodes: KnowledgeNode[], traces: Trace[]): TrailState {
  return { ...EMPTY_TRAIL, nodes, traces };
}

describe("layoutTrail", () => {
  const nodes = Array.from({ length: 9 }, (_, index) => node(`n${index}`));

  it("keeps a node where it is as the map grows", () => {
    const small = layoutTrail(nodes.slice(0, 4), 600).positions;
    const large = layoutTrail(nodes, 600).positions;
    for (const { id } of nodes.slice(0, 4)) {
      expect(large.get(id)).toEqual(small.get(id));
    }
  });

  it("winds back and forth instead of jumping across each row", () => {
    const { positions } = layoutTrail(nodes.slice(0, 6), 510);
    // Three columns: the fourth node sits under the third, not under the first.
    const third = positions.get("n2")!;
    const fourth = positions.get("n3")!;
    const first = positions.get("n0")!;
    expect(Math.abs(fourth.x - third.x)).toBeLessThan(Math.abs(fourth.x - first.x));
    expect(fourth.y).toBeGreaterThan(third.y);
  });

  it("keeps every node inside the width and the height", () => {
    for (const width of [300, 600, 1200]) {
      const { positions, height } = layoutTrail(nodes, width);
      for (const { x, y } of positions.values()) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(width);
        expect(y).toBeLessThan(height);
      }
    }
  });

  it("handles an empty map and an unmeasured width", () => {
    expect(layoutTrail([], 600).positions.size).toBe(0);
    expect(layoutTrail(nodes, 0).positions.size).toBe(9);
  });
});

describe("walkedSegments", () => {
  it("follows the traces, including the way back from a hole", () => {
    const segments = walkedSegments(
      trail(
        [node("a"), node("back"), node("gd")],
        [trace(["a"]), trace(["back"]), trace(["gd", "back"])],
      ),
    );
    expect(segments).toEqual([
      ["a", "back"],
      ["gd", "back"],
    ]);
  });

  it("leaves holes off the path until they are filled", () => {
    const segments = walkedSegments(
      trail(
        [node("a"), node("hole", "unseen"), node("b")],
        [trace(["a"]), trace(["hole"]), trace(["b"])],
      ),
    );
    expect(segments).toEqual([["a", "b"]]);
  });

  it("repeats nothing and ignores staying in place", () => {
    const segments = walkedSegments(
      trail(
        [node("a"), node("b")],
        [trace(["a"]), trace(["a"]), trace(["b"]), trace(["a"])],
      ),
    );
    expect(segments).toEqual([["b", "a"]]);
  });

  it("puts the most recently walked segment last", () => {
    const segments = walkedSegments(
      trail(
        [node("a"), node("b"), node("c")],
        [trace(["a"]), trace(["b"]), trace(["c"]), trace(["b"]), trace(["a"])],
      ),
    );
    expect(segments).toEqual([
      ["c", "b"],
      ["b", "a"],
    ]);
  });
});

describe("drawing helpers", () => {
  it("stops a line short of its end", () => {
    expect(stopShort({ x: 0, y: 0 }, { x: 100, y: 0 }, 30)).toEqual({
      x: 70,
      y: 0,
    });
  });

  it("does not overshoot when the points are close", () => {
    const from = { x: 0, y: 0 };
    expect(stopShort(from, { x: 10, y: 0 }, 30)).toEqual(from);
  });

  it("draws a curve from one point to the other", () => {
    const path = curvePath({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(path.startsWith("M 0.0 0.0 Q")).toBe(true);
    expect(path.endsWith("10.0 0.0")).toBe(true);
  });
});

describe("a hole between two walked nodes", () => {
  it("sits off the straight line between them", () => {
    const nodes = [node("a"), node("hole", "unseen"), node("b")];
    const { positions } = layoutTrail(nodes, 800);
    const a = positions.get("a")!;
    const hole = positions.get("hole")!;
    const b = positions.get("b")!;

    const lineY = a.y + ((b.y - a.y) * (hole.x - a.x)) / (b.x - a.x);
    const NODE_RADIUS = 22;
    expect(Math.abs(hole.y - lineY)).toBeGreaterThan(NODE_RADIUS);
  });
});
