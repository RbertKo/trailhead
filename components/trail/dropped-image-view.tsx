"use client";

import { useState } from "react";

import type { Copy } from "@/lib/trail/copy";
import type { DropRegion } from "@/lib/trail/types";

/** A dropped image, with the part SAM 3.1 picked out drawn over it. */
export function DroppedImageView({
  url,
  region,
  copy,
}: {
  url: string;
  region: DropRegion | undefined;
  copy: Copy;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  return (
    <figure className="flex max-w-[70%] flex-col items-end gap-1">
      <div className="relative overflow-hidden rounded-xl border border-border">
        {/* A data URL from the learner's own file, so next/image does not apply. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={copy.droppedImageAlt}
          className="block max-h-56 w-auto"
          onLoad={({ currentTarget }) =>
            setSize({
              width: currentTarget.naturalWidth,
              height: currentTarget.naturalHeight,
            })
          }
        />
        {region && size && (
          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            className="absolute inset-0 size-full animate-in fade-in duration-700"
            aria-hidden
          >
            <path
              d={region.maskPath}
              transform={`translate(${region.bounds.left} ${region.bounds.top}) scale(${
                (region.bounds.right - region.bounds.left) / region.maskWidth
              } ${(region.bounds.bottom - region.bounds.top) / region.maskHeight})`}
              className="fill-state-fuzzy/45"
              fillRule="evenodd"
            />
          </svg>
        )}
      </div>
      {region && (
        <figcaption className="text-xs text-muted-foreground animate-in fade-in">
          {copy.regionNote(region.concept)}
        </figcaption>
      )}
    </figure>
  );
}
