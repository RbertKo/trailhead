import type { KnowledgeNode, TrailState } from "./types";

export interface Point {
  x: number;
  y: number;
}

const COLUMN_WIDTH = 170;
const ROW_HEIGHT = 156;
const TOP_MARGIN = 84;
const BOTTOM_MARGIN = 120;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 5;
/** Neighbours sit above and below each other, so the path skirts a hole between. */
const ZIGZAG = 24;

/** A small, stable offset per node, so the map reads as a walk and not a grid. */
function jitter(id: string, range: number, salt: number): number {
  let hash = salt;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  return ((hash % 1000) / 1000 - 0.5) * range;
}

/**
 * Lays nodes out along a winding path, in the order they first appeared. A node
 * keeps its place as the map grows, so new ground never rearranges old ground.
 */
export function layoutTrail(nodes: KnowledgeNode[], width: number) {
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(MIN_COLUMNS, Math.floor(width / COLUMN_WIDTH)),
  );
  const columnWidth = width / columns;

  const positions = new Map<string, Point>();
  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const step = index % columns;
    const column = row % 2 === 0 ? step : columns - 1 - step;
    positions.set(node.id, {
      x: columnWidth * (column + 0.5) + jitter(node.id, columnWidth * 0.2, 7),
      y:
        TOP_MARGIN +
        ROW_HEIGHT * row +
        (index % 2 === 0 ? -ZIGZAG : ZIGZAG) +
        jitter(node.id, 10, 13),
    });
  });

  const rows = Math.ceil(nodes.length / columns);
  return {
    positions,
    height: TOP_MARGIN + ROW_HEIGHT * Math.max(rows - 1, 0) + BOTTOM_MARGIN,
  };
}

/**
 * The walked path, from the traces rather than from anything stored: each pair
 * of concepts the learner moved between, once, the most recently walked last.
 * Holes are never on it.
 */
export function walkedSegments(trail: TrailState): [string, string][] {
  const walkable = new Set(
    trail.nodes.filter((node) => node.state !== "unseen").map((node) => node.id),
  );
  const segments = new Map<string, [string, string]>();

  let previous: string | null = null;
  for (const trace of trail.traces) {
    for (const nodeId of trace.nodeIds) {
      if (!walkable.has(nodeId)) continue;
      if (previous && previous !== nodeId) {
        const key = [previous, nodeId].sort().join("|");
        segments.delete(key);
        segments.set(key, [previous, nodeId]);
      }
      previous = nodeId;
    }
  }
  return [...segments.values()];
}

/** A gentle curve between two points, bowed to one side. */
export function curvePath(from: Point, to: Point, bow = 0.12): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const controlX = (from.x + to.x) / 2 - dy * bow;
  const controlY = (from.y + to.y) / 2 + dx * bow;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** Stops a line short of a point, so an arrowhead isn't hidden under the node. */
export function stopShort(from: Point, to: Point, distance: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= distance) return from;
  const ratio = (length - distance) / length;
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}
