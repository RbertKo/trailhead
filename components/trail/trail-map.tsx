"use client";

import { Clock3, MapPin } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { Copy } from "@/lib/trail/copy";
import { isRecallDue } from "@/lib/trail/engine";
import type { DroppedImage } from "@/lib/trail/image";
import {
  curvePath,
  layoutTrail,
  stopShort,
  walkedSegments,
} from "@/lib/trail/layout";
import type { KnowledgeNode, TrailState } from "@/lib/trail/types";

import { STATE_ICONS } from "./map-pane";

const NODE_RADIUS = 22;
const RECENT_SEGMENTS = 4;

function latestDropImage(
  node: KnowledgeNode,
  trail: TrailState,
  images: Record<string, DroppedImage>,
) {
  const imageId = trail.traces.findLast(
    (trace) =>
      trace.type === "drop" &&
      trace.imageId !== null &&
      trace.nodeIds.includes(node.id),
  )?.imageId;
  return imageId ? images[imageId]?.thumbnail : undefined;
}

export function TrailMap({
  trail,
  clock,
  images,
  selectedId,
  copy,
  onSelect,
}: {
  trail: TrailState;
  clock: number;
  images: Record<string, DroppedImage>;
  selectedId: string | null;
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

  const { positions, height } = useMemo(
    () => layoutTrail(trail.nodes, width),
    [trail.nodes, width],
  );
  const route = useMemo(() => walkedSegments(trail), [trail]);

  const prerequisiteEdges = trail.nodes.flatMap((node) =>
    node.prerequisiteIds.flatMap((prerequisiteId) => {
      const prerequisite = trail.nodes.find(({ id }) => id === prerequisiteId);
      return prerequisite ? [{ from: prerequisite, to: node }] : [];
    }),
  );
  const parentEdges = trail.nodes.flatMap((node) => {
    const parent = trail.nodes.find(({ id }) => id === node.parentId);
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
            const Icon = STATE_ICONS[node.state];
            const isFocus = trail.focusId === node.id;
            const isDue = isRecallDue(node, clock);
            const thumbnail = latestDropImage(node, trail, images);

            return (
              <button
                key={node.id}
                type="button"
                aria-pressed={selectedId === node.id}
                aria-label={`${node.label}, ${copy.states[node.state]}`}
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
                  <span key={node.state} className="trail-dot" data-state={node.state}>
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
                    node.state === "unseen"
                      ? "text-state-hole"
                      : node.state === "fuzzy"
                        ? "text-state-fuzzy-ink"
                        : "text-muted-foreground",
                  )}
                >
                  {copy.states[node.state]}
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
