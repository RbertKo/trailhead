"use client";

import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";

export function ImagePanel() {
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { url } = await postJson<{ url: string }>("/api/image", { prompt });
      setImageUrl(url);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe an image"
          aria-label="Image prompt"
        />
        <Button type="submit" disabled={pending || !prompt.trim()}>
          {pending ? "Generating…" : "Generate"}
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {imageUrl && (
        // A temporary signed URL on a remote host, so next/image does not apply.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={prompt}
          className="w-full rounded-lg border border-border"
        />
      )}
    </div>
  );
}
