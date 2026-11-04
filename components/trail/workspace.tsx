"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Footprints } from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type DragEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/trail/copy";
import { advanceTime } from "@/lib/trail/engine";
import {
  cropRegionThumbnail,
  isUsefulRegion,
  prepareImage,
  type DroppedImage,
} from "@/lib/trail/image";
import {
  buildTurnRequest,
  type Locale,
  type TrailUIMessage,
} from "@/lib/trail/request";
import {
  EMPTY_TRAIL,
  type DropRegion,
  type TrailState,
} from "@/lib/trail/types";

import { ChatLog } from "./chat-log";
import { Composer } from "./composer";
import { MapPane } from "./map-pane";

const DAY = 24 * 60 * 60 * 1000;

/** The region is an enhancement: if it can't be found, the turn stands as it is. */
async function findRegion(image: DroppedImage, concept: string) {
  try {
    const response = await fetch("/api/region", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: { id: image.id, url: image.url },
        concept,
      }),
    });
    if (!response.ok) return null;
    const { region } = (await response.json()) as { region: DropRegion | null };
    return region;
  } catch {
    return null;
  }
}

// The browser holds the trail, so each send passes the current one in `body`.
const transport = new DefaultChatTransport<TrailUIMessage>({
  api: "/api/turn",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: buildTurnRequest(messages, body?.trail, body?.locale),
  }),
});

export function Workspace() {
  const [locale, setLocale] = useState<Locale>("ko");
  const copy = COPY[locale];

  // The whole session lives in this component: nothing is stored on the server.
  const [trail, setTrail] = useState<TrailState>(EMPTY_TRAIL);
  const trailRef = useRef(trail);
  const [clock, setClock] = useState(0);
  const [elapsedDays, setElapsedDays] = useState(0);
  const [images, setImages] = useState<Record<string, DroppedImage>>({});
  const imagesRef = useRef(images);
  const [regions, setRegions] = useState<Record<string, DropRegion>>({});

  const [input, setInput] = useState("");
  const [attached, setAttached] = useState<DroppedImage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const updateTrail = useCallback((next: TrailState) => {
    trailRef.current = next;
    setTrail(next);
    setClock(Date.now());
  }, []);

  const rememberImage = useCallback((image: DroppedImage) => {
    imagesRef.current = { ...imagesRef.current, [image.id]: image };
    setImages(imagesRef.current);
  }, []);

  // The image of the turn in flight, for when the reading names its key region.
  const sentImageRef = useRef<DroppedImage | null>(null);
  // The trail as the turn in flight found it, so a retry can start over from it.
  const trailBeforeTurnRef = useRef(trail);

  // Separate from the turn, so a slow search never holds up the reply or the input.
  const showRegion = useCallback(
    async (image: DroppedImage, concept: string) => {
      const region = await findRegion(image, concept);
      if (!region || !isUsefulRegion(image, region)) return;
      setRegions((current) => ({ ...current, [image.id]: region }));
      const thumbnail = await cropRegionThumbnail(image, region);
      if (thumbnail) rememberImage({ ...image, thumbnail });
    },
    [rememberImage],
  );

  const { messages, sendMessage, regenerate, status, stop, error } =
    useChat<TrailUIMessage>({
      transport,
      onData: (part) => {
        if (part.type === "data-trail") updateTrail(part.data);
        if (part.type === "data-callout") {
          const image = sentImageRef.current;
          if (image && part.data.keyRegion) {
            void showRegion(image, part.data.keyRegion);
          }
        }
      },
    });
  const isBusy = status === "submitted" || status === "streaming";

  // Decoding an image takes a moment, and the learner may type or send meanwhile.
  const latestRef = useRef({ input, attached, isBusy });
  useEffect(() => {
    latestRef.current = { input, attached, isBusy };
  });

  function requestOptions() {
    return { body: { trail: trailRef.current, locale } };
  }

  function send(text: string, image: DroppedImage | null) {
    const trimmed = text.trim();
    if (latestRef.current.isBusy || (!trimmed && !image)) return;

    setNotice(null);
    sentImageRef.current = image;
    trailBeforeTurnRef.current = trailRef.current;

    const options = requestOptions();
    if (!image) {
      void sendMessage({ text: trimmed }, options);
      return;
    }
    rememberImage(image);
    const files = [
      { type: "file" as const, mediaType: "image/jpeg", url: image.url },
    ];
    const metadata = { imageId: image.id };
    void sendMessage(
      trimmed ? { text: trimmed, files, metadata } : { files, metadata },
      options,
    );
  }

  /** Throwing is the whole gesture, unless a question is already being typed. */
  async function throwFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setNotice(copy.imagesOnly);
      return;
    }
    try {
      const image = await prepareImage(file);
      const latest = latestRef.current;
      if (latest.input.trim() || latest.attached || latest.isBusy) {
        setAttached(image);
      } else {
        send("", image);
      }
    } catch {
      setNotice(copy.imageUnreadable);
    }
  }

  function retryTurn() {
    updateTrail(trailBeforeTurnRef.current);
    void regenerate(requestOptions());
  }

  function submitComposer() {
    if (isBusy) return;
    send(input, attached);
    setInput("");
    setAttached(null);
  }

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    // Spreadsheets and documents copy text along with a picture of it. Text wins.
    if (event.clipboardData?.getData("text/plain")) return;
    const image = [...(event.clipboardData?.files ?? [])].find((file) =>
      file.type.startsWith("image/"),
    );
    if (image) {
      event.preventDefault();
      void throwFile(image);
    }
  });

  // On the window, so a screenshot can be pasted without clicking anywhere first.
  useEffect(() => {
    const listener = (event: ClipboardEvent) => onPaste(event);
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent) {
    // Moving between children also fires this. Only leaving the window counts.
    if (event.relatedTarget === null) setIsDragging(false);
  }

  function handleDrop(event: DragEvent) {
    // Dragging selected text into the message box should still work.
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void throwFile(file);
  }

  const passTime = useCallback(
    (days: number) => {
      const now = Date.now();
      updateTrail(advanceTime(trailRef.current, days * DAY, now));
      // A retry goes back to this, and time has passed for it too.
      trailBeforeTurnRef.current = advanceTime(
        trailBeforeTurnRef.current,
        days * DAY,
        now,
      );
      setElapsedDays((current) => current + days);
    },
    [updateTrail],
  );

  return (
    <div
      className="relative grid h-dvh grid-rows-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-rows-1"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <section className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
        <header className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-2.5">
            <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
              <Footprints className="size-4 translate-y-px text-primary" aria-hidden />
              Trailhead
            </h1>
            <p className="text-xs text-muted-foreground">{copy.tagline}</p>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
          >
            {COPY[locale === "ko" ? "en" : "ko"].languageName}
          </Button>
        </header>

        <ChatLog
          messages={messages}
          status={status}
          offersRevisit={trail.pending?.kind === "revisit"}
          error={error}
          notice={notice}
          regions={regions}
          copy={copy}
          onQuickReply={(text) => send(text, null)}
          onRetry={retryTurn}
        />

        <Composer
          value={input}
          attached={attached}
          isBusy={isBusy}
          copy={copy}
          onChange={setInput}
          onSubmit={submitComposer}
          onStop={() => void stop()}
          onFile={(file) => void throwFile(file)}
          onRemoveImage={() => setAttached(null)}
        />
      </section>

      <MapPane
        trail={trail}
        clock={clock}
        images={images}
        selectedId={selectedId}
        elapsedDays={elapsedDays}
        isBusy={isBusy}
        copy={copy}
        onSelect={setSelectedId}
        onPassTime={passTime}
      />

      {isDragging && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <p className="text-lg font-medium text-primary">{copy.dropHere}</p>
        </div>
      )}
    </div>
  );
}
