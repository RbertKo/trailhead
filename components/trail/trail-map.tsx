"use client";

import { Clock3, MapPin } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { Copy } from "@/lib/trail/copy";
import { findById, isRecallDue } from "@/lib/trail/engine";
import type { DroppedImage } from "@/lib/trail/image";
import {
  curvePath,
  layoutTrail,
  stopShort,
  walkedSegments,
} from "@/lib/trail/layout";
import type { TrailState } from "@/lib/trail/types";

import { STATE_ICONS } from "./state-icons";

const NODE_RADIUS = 22;
const RECENT_SEGMENTS = 4;

/** Each concept's most recently dropped image. */
function latestDrops(trail: TrailState) {
  const drops = new Map<string, string>();
  for (const { type, imageId, nodeIds } of trail.traces) {
    if (type !== "drop" || !imageId) continue;
    for (const nodeId of nodeIds) drops.set(nodeId, imageId);
  }
  return drops;
}

export function TrailMap({
  trail,
  clock,
  images,
  selectedId,
  isBusy,
  copy,
  onSelect,
}: {
  trail: TrailState;
  clock: number;
  images: Record<string, DroppedImage>;
  selectedId: string | null;
  isBusy: boolean;
  copy: Copy;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Once the map outgrows the pane, new ground would otherwise appear out of sight.
  const focusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [trail.focusId, width]);

  const { positions, height } = useMemo(
    () => layoutTrail(trail.nodes, width),
    [trail.nodes, width],
  );
  const route = useMemo(() => walkedSegments(trail), [trail]);
  const drops = useMemo(() => latestDrops(trail), [trail]);

  const prerequisiteEdges = trail.nodes.flatMap((node) =>
    node.prerequisiteIds.flatMap((prerequisiteId) => {
      const prerequisite = findById(trail.nodes, prerequisiteId);
      return prerequisite ? [{ from: prerequisite, to: node }] : [];
    }),
  );
  const parentEdges = trail.nodes.flatMap((node) => {
    const parent = findById(trail.nodes, node.parentId);
    return parent ? [{ from: parent, to: node }] : [];
  });

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      {width > 0 && (
        <>
          <svg
            width={width}
            height={height}
            className="pointer-events-none absolute inset-0"
            aria-hidden
          >
            <defs>
              <marker
                id="trail-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
              </marker>
            </defs>

            {parentEdges.map(({ from, to }) => {
              const start = positions.get(from.id);
              const end = positions.get(to.id);
              if (!start || !end) return null;
              return (
                <path
                  key={`parent-${from.id}-${to.id}`}
                  d={curvePath(start, end, -0.08)}
                  fill="none"
                  className="stroke-muted-foreground/30"
                  strokeWidth={1}
                />
              );
            })}

            {prerequisiteEdges.map(({ from, to }) => {
              const start = positions.get(from.id);
              const end = positions.get(to.id);
              if (!start || !end) return null;
              const isHole = from.state === "unseen";
              return (
                <path
                  key={`needs-${from.id}-${to.id}`}
                  d={curvePath(start, stopShort(start, end, NODE_RADIUS + 6), 0.16)}
                  fill="none"
                  className={cn(
                    "transition-colors duration-700",
                    isHole ? "stroke-state-hole" : "stroke-muted-foreground/45",
                  )}
                  strokeWidth={isHole ? 1.5 : 1.25}
                  strokeDasharray={isHole ? "4 4" : undefined}
                  markerEnd="url(#trail-arrow)"
                />
              );
            })}

            {route.map(([from, to], index) => {
              const start = positions.get(from);
              const end = positions.get(to);
              if (!start || !end) return null;
              // Old ground recedes, or a wandering walk turns into a tangle.
              const isRecent = index >= route.length - RECENT_SEGMENTS;
              return (
                <path
                  key={[from, to].sort().join("-")}
                  d={curvePath(start, end)}
                  fill="none"
                  className={cn(
                    "stroke-route transition-opacity duration-700",
                    !isRecent && "opacity-30",
                  )}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeDasharray="0.1 11"
                />
              );
            })}
          </svg>

          {trail.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const isFocus = trail.focusId === node.id;
            // It counts as seen once the reply ends. Until then it's no hole either.
            const isBeingRead = isBusy && isFocus && node.state === "unseen";
            const Icon = STATE_ICONS[isBeingRead ? "seen" : node.state];
            const stateLabel = isBeingRead
              ? copy.beingRead
              : copy.states[node.state];
            const isDue = isRecallDue(node, clock);
            const thumbnail = images[drops.get(node.id) ?? ""]?.thumbnail;

            return (
              <button
                key={node.id}
                ref={isFocus ? focusRef : undefined}
                type="button"
                aria-pressed={selectedId === node.id}
                aria-label={`${node.label}, ${stateLabel}`}
                title={copy.stateHelp[node.state]}
                className="absolute flex w-32 -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl p-1 outline-offset-2 animate-in fade-in zoom-in-75 duration-500 motion-reduce:animate-none"
                style={{ left: position.x, top: position.y - NODE_RADIUS - 4 }}
                onClick={() => onSelect(selectedId === node.id ? null : node.id)}
              >
                <span className="relative">
                  {isFocus && (
                    <>
                      <span className="absolute -inset-1.5 animate-pulse rounded-full border-2 border-primary motion-reduce:animate-none" />
                      <MapPin
                        className="absolute -top-5 left-1/2 size-4 -translate-x-1/2 fill-card text-primary"
                        aria-label={copy.youAreHere}
                      />
                    </>
                  )}
                  {/* The key restarts the animation, so a change of state is noticed. */}
                  <span
                    key={node.state}
                    className="trail-dot"
                    data-state={node.state}
                    data-reading={isBeingRead || undefined}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {isDue && (
                    <span
                      className="absolute -bottom-0.5 -left-1 rounded-full bg-card p-0.5 text-primary shadow-sm animate-in zoom-in"
                      title={copy.due}
                    >
                      <Clock3 className="size-3" aria-label={copy.due} />
                    </span>
                  )}
                  {thumbnail && (
                    // A data URL from the learner's own file.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnail}
                      alt=""
                      className="absolute -top-2 -right-5 size-8 rounded-md border-2 border-card object-cover shadow-sm animate-in zoom-in duration-500"
                    />
                  )}
                </span>
                {/* The paper-coloured backing keeps lines from striking through text. */}
                <span className="line-clamp-2 rounded bg-map/85 px-1 text-center text-[13px] leading-tight font-medium text-balance">
                  {node.label}
                </span>
                <span
                  className={cn(
                    "-mt-1 rounded bg-map/85 px-1 text-[11px] leading-tight",
                    isBeingRead
                      ? "text-muted-foreground"
                      : node.state === "unseen"
                        ? "text-state-hole"
                        : node.state === "fuzzy"
                          ? "text-state-fuzzy-ink"
                          : "text-muted-foreground",
                  )}
                >
                  {stateLabel}
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
