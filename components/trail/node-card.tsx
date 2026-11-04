"use client";

import { X } from "lucide-react";

import type { Copy } from "@/lib/trail/copy";
import { findById } from "@/lib/trail/engine";
import type { DroppedImage } from "@/lib/trail/image";
import type { KnowledgeNode, TrailState } from "@/lib/trail/types";

import { STATE_ICONS } from "./state-icons";

const MAX_TRACES_SHOWN = 6;

/** Details of one concept, opened by clicking it. The map never requires this. */
export function NodeCard({
  node,
  trail,
  clock,
  images,
  copy,
  onSelect,
}: {
  node: KnowledgeNode;
  trail: TrailState;
  clock: number;
  images: Record<string, DroppedImage>;
  copy: Copy;
  onSelect: (id: string | null) => void;
}) {
  const Icon = STATE_ICONS[node.state];
  const parent = findById(trail.nodes, node.parentId);
  const prerequisites = node.prerequisiteIds.flatMap(
    (id) => findById(trail.nodes, id) ?? [],
  );
  const traces = node.sources
    .flatMap((id) => trail.traces.find((trace) => trace.id === id) ?? [])
    .slice(-MAX_TRACES_SHOWN);
  const ago = (time: number) => copy.ago(Math.max(0, clock - time));

  return (
    <aside className="absolute right-3 bottom-14 z-20 flex max-h-[70%] w-[min(22rem,calc(100%-1.5rem))] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-4 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold tracking-tight wrap-anywhere">
            {node.label}
          </h3>
          <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Icon className="size-3.5" aria-hidden />
            {copy.states[node.state]}
            <span className="font-normal">· {copy.stateHelp[node.state]}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label={copy.close}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onSelect(null)}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* A filled hole has no summary until the model places it itself. Its
          explanation is under the traces below. */}
      {(node.summary || node.state === "unseen") && (
        <p className="leading-relaxed text-pretty">
          {node.summary || copy.noSummary}
        </p>
      )}

      {(parent || prerequisites.length > 0) && (
        <dl className="flex flex-col gap-1.5 text-xs">
          {parent && (
            <div className="flex flex-wrap items-center gap-1.5">
              <dt className="text-muted-foreground">{copy.under}</dt>
              <dd>
                <NodeLink node={parent} onSelect={onSelect} />
              </dd>
            </div>
          )}
          {prerequisites.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <dt className="text-muted-foreground">{copy.needs}</dt>
              {prerequisites.map((prerequisite) => (
                <dd key={prerequisite.id}>
                  <NodeLink node={prerequisite} onSelect={onSelect} />
                </dd>
              ))}
            </div>
          )}
        </dl>
      )}

      {node.state !== "unseen" && (
        <p className="text-xs text-muted-foreground">
          {copy.firstSeen(ago(node.firstSeenAt))}
          <br />
          {copy.lastTouched(ago(node.lastTouchedAt))}
          <br />
          {node.lastCheckedAt === null
            ? copy.neverChecked
            : copy.lastChecked(ago(node.lastCheckedAt))}
        </p>
      )}

      {traces.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <h4 className="text-xs font-medium text-muted-foreground">
            {copy.traces}
          </h4>
          <ol className="flex flex-col gap-2">
            {traces.map((trace) => {
              const image = trace.imageId ? images[trace.imageId] : undefined;
              return (
                <li key={trace.id} className="flex gap-2 text-xs">
                  <span className="w-9 shrink-0 text-muted-foreground">
                    {copy.traceTypes[trace.type]}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    {image && (
                      // A data URL from the learner's own file.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image.thumbnail}
                        alt={copy.droppedImageAlt}
                        className="h-14 w-fit rounded-md border border-border object-cover"
                      />
                    )}
                    <span className="line-clamp-3 leading-relaxed wrap-anywhere">
                      {/* Replies are Markdown. A preview just drops the emphasis. */}
                      {trace.content.replaceAll("**", "")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </aside>
  );
}

function NodeLink({
  node,
  onSelect,
}: {
  node: KnowledgeNode;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="rounded-md bg-muted px-1.5 py-0.5 hover:bg-accent"
      onClick={() => onSelect(node.id)}
    >
      {node.label}
    </button>
  );
}
