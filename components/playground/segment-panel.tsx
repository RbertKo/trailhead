"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";
import type { SegmentedObject } from "@/lib/meta/segment-result";

// A larger file would exceed the API route's body limit once base64-encoded.
const MAX_FILE_BYTES = 3 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

function MaskOverlay({
  objects,
  width,
  height,
}: {
  objects: SegmentedObject[];
  width: number;
  height: number;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="absolute inset-0 size-full"
      aria-hidden
    >
      {objects.map((object, index) => {
        const { left, top, right, bottom } = object.bounds;
        const scaleX = (right - left) / object.maskWidth;
        const scaleY = (bottom - top) / object.maskHeight;
        return (
          <path
            key={object.objectId}
            d={object.maskPath}
            transform={`translate(${left} ${top}) scale(${scaleX} ${scaleY})`}
            fill={`var(--chart-${(index % 5) + 1})`}
            fillOpacity={0.55}
            fillRule="evenodd"
          />
        );
      })}
    </svg>
  );
}

export function SegmentPanel() {
  const [imageUrl, setImageUrl] = useState("");
  const [concept, setConcept] = useState("");
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [objects, setObjects] = useState<SegmentedObject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function selectImage(url: string) {
    setImageUrl(url);
    setImageSize(null);
    setObjects(null);
    setError(null);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("Choose an image of 3 MB or less.");
      return;
    }
    try {
      selectImage(await readAsDataUrl(file));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setObjects(null);
    try {
      const result = await postJson<{ objects: SegmentedObject[] }>(
        "/api/segment",
        { imageUrl, concept },
      );
      setObjects(result.objects);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {/* Locked while a request runs, so its masks cannot land on a new image. */}
        <Input
          value={imageUrl.startsWith("data:") ? "" : imageUrl}
          onChange={(event) => selectImage(event.target.value)}
          placeholder="https://… image URL"
          aria-label="Image URL"
          disabled={pending}
        />
        <Input
          type="file"
          accept="image/*"
          onChange={handleFile}
          aria-label="Image file"
          disabled={pending}
        />
        <div className="flex gap-2">
          <Input
            value={concept}
            onChange={(event) => setConcept(event.target.value)}
            placeholder="What to find, e.g. duck"
            aria-label="Object to segment"
          />
          <Button
            type="submit"
            disabled={pending || !imageUrl || !concept.trim()}
          >
            {pending ? "Segmenting…" : "Segment"}
          </Button>
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {objects && (
        <p className="text-sm text-muted-foreground">
          {objects.length === 0
            ? "No matches found."
            : `${objects.length} object(s) found.`}
        </p>
      )}

      {imageUrl && (
        <div className="relative overflow-hidden rounded-lg border border-border">
          {/* A user-supplied URL or data URL, so next/image does not apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Segmentation input"
            className="block w-full"
            onLoad={({ currentTarget }) =>
              setImageSize({
                width: currentTarget.naturalWidth,
                height: currentTarget.naturalHeight,
              })
            }
          />
          {objects && imageSize && (
            <MaskOverlay objects={objects} {...imageSize} />
          )}
        </div>
      )}
    </div>
  );
}
