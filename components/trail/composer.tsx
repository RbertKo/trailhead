"use client";

import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Copy } from "@/lib/trail/copy";
import type { DroppedImage } from "@/lib/trail/image";
import { MAX_MESSAGE_TEXT } from "@/lib/trail/request";

export function Composer({
  value,
  attached,
  isBusy,
  copy,
  onChange,
  onSubmit,
  onStop,
  onFile,
  onRemoveImage,
}: {
  value: string;
  attached: DroppedImage | null;
  isBusy: boolean;
  copy: Copy;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onFile: (file: File) => void;
  onRemoveImage: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = value.trim() !== "" || attached !== null;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter also confirms Korean composition. That one must not send the message.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!isBusy) onSubmit();
    }
  }

  return (
    <form
      className="px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="rounded-2xl border border-input bg-card shadow-xs transition-colors focus-within:border-ring">
        {attached && (
          <div className="relative m-2 mb-0 w-fit">
            {/* A data URL from the learner's own file. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attached.thumbnail}
              alt={copy.droppedImageAlt}
              className="h-14 rounded-lg border border-border"
            />
            <button
              type="button"
              aria-label={copy.removeImage}
              className="absolute -top-1.5 -right-1.5 rounded-full border border-border bg-card p-0.5 text-muted-foreground hover:text-foreground"
              onClick={onRemoveImage}
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        )}
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          maxLength={MAX_MESSAGE_TEXT}
          rows={1}
          className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-3.5 pt-3 pb-1 shadow-none focus-visible:ring-0"
          autoFocus
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copy.attach}
            title={copy.attach}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus aria-hidden />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              // So choosing the same file again still fires this.
              event.target.value = "";
            }}
          />
          {isBusy ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={copy.stop}
              title={copy.stop}
              onClick={onStop}
            >
              <Square aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              aria-label={copy.send}
              title={copy.send}
              disabled={!canSend}
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
