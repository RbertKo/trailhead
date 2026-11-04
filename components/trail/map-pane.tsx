"use client";

import { Check, CircleDashed, CloudFog, Clock3, Footprints, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Copy } from "@/lib/trail/copy";
import { findById } from "@/lib/trail/engine";
import type { DroppedImage } from "@/lib/trail/image";
import {
  NODE_STATES,
  type NodeState,
  type TrailState,
} from "@/lib/trail/types";

import { Contours } from "./contours";
import { NodeCard } from "./node-card";
import { TrailMap } from "./trail-map";

const TIME_STEPS = [1, 7, 30];

export const STATE_ICONS: Record<NodeState, LucideIcon> = {
  solid: Check,
  seen: Footprints,
  fuzzy: CloudFog,
  unseen: CircleDashed,
};

export function MapPane({
  trail,
  clock,
  images,
  selectedId,
  elapsedDays,
  isBusy,
  copy,
  onSelect,
  onPassTime,
}: {
  trail: TrailState;
  clock: number;
  images: Record<string, DroppedImage>;
  selectedId: string | null;
  elapsedDays: number;
  isBusy: boolean;
  copy: Copy;
  onSelect: (id: string | null) => void;
  onPassTime: (days: number) => void;
}) {
  const count = (state: NodeState) =>
    trail.nodes.filter((node) => node.state === state).length;
  const walked = trail.nodes.length - count("unseen");
  const selected = findById(trail.nodes, selectedId);

  return (
    <section className="relative flex min-h-0 flex-col overflow-hidden bg-map">
      <Contours />

      <header className="relative z-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-base font-semibold tracking-tight">
            {copy.mapTitle}
          </h2>
          {trail.nodes.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {copy.stats(walked, count("solid"), count("unseen"))}
            </p>
          )}
        </div>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {NODE_STATES.map((state) => (
            <li
              key={state}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title={copy.stateHelp[state]}
            >
              <span className="trail-dot trail-dot--small" data-state={state} />
              {copy.states[state]}
            </li>
          ))}
        </ul>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {trail.nodes.length === 0 ? (
          <p className="flex h-full items-center justify-center px-8 pb-10 text-center text-sm text-muted-foreground text-pretty">
            {copy.mapEmpty}
          </p>
        ) : (
          <TrailMap
            trail={trail}
            clock={clock}
            images={images}
            selectedId={selectedId}
            copy={copy}
            onSelect={onSelect}
          />
        )}
      </div>

      {selected && (
        <NodeCard
          node={selected}
          trail={trail}
          clock={clock}
          images={images}
          copy={copy}
          onSelect={onSelect}
        />
      )}

      <footer className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-map-line px-5 py-2.5">
        <Clock3 className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">{copy.timeLabel}</span>
        {TIME_STEPS.map((days) => (
          <Button
            key={days}
            variant="outline"
            size="xs"
            className="bg-card tabular-nums"
            disabled={isBusy || trail.nodes.length === 0}
            onClick={() => onPassTime(days)}
          >
            {copy.plusDays(days)}
          </Button>
        ))}
        {elapsedDays > 0 && (
          <span className="ml-1 text-xs font-medium text-primary tabular-nums animate-in fade-in">
            {copy.elapsed(elapsedDays)}
          </span>
        )}
      </footer>
    </section>
  );
}
