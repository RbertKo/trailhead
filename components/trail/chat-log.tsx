"use client";

import type { ChatStatus } from "ai";
import { useEffect, useRef } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { readableChatError } from "@/lib/api/client";
import type { Copy } from "@/lib/trail/copy";
import {
  messageCallout,
  messageImageUrl,
  messageText,
  type TrailUIMessage,
} from "@/lib/trail/request";
import type { DropRegion } from "@/lib/trail/types";

import { DroppedImageView } from "./dropped-image-view";
import { ReplyText } from "./reply-text";
import { TurnCalloutView } from "./turn-callout-view";

const NEAR_BOTTOM_PX = 120;

function isNearBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <
    NEAR_BOTTOM_PX
  );
}

export function ChatLog({
  messages,
  status,
  error,
  notice,
  regions,
  copy,
  onQuickReply,
}: {
  messages: TrailUIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  notice: string | null;
  regions: Record<string, DropRegion>;
  copy: Copy;
  onQuickReply: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followsRef = useRef(true);

  // Follows anything that makes the log taller, including a dropped image that
  // finishes loading, unless the learner has scrolled up to read something.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const observer = new ResizeObserver(() => {
      if (followsRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Sending something always brings the log back to the conversation.
  useEffect(() => {
    if (status !== "submitted") return;
    followsRef.current = true;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [status]);

  const last = messages.at(-1);
  const offersRevisit =
    status === "ready" &&
    last?.role === "assistant" &&
    messageCallout(last)?.kind === "revisit_offer";

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-4"
      aria-live="polite"
      onScroll={({ currentTarget }) => {
        followsRef.current = isNearBottom(currentTarget);
      }}
    >
      <div ref={contentRef} className={messages.length === 0 ? "h-full" : ""}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-center gap-2 pb-16">
            <p className="text-xl font-semibold tracking-tight text-balance">
              {copy.emptyTitle}
            </p>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground text-pretty">
              {copy.emptyBody}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-5">
            {messages.map((message) =>
              message.role === "user" ? (
                <UserMessage
                  key={message.id}
                  message={message}
                  regions={regions}
                  copy={copy}
                />
              ) : (
                <AssistantMessage key={message.id} message={message} copy={copy} />
              ),
            )}
          </ol>
        )}

        {status === "submitted" && (
          <p className="mt-5 animate-pulse text-sm text-muted-foreground motion-reduce:animate-none">
            {copy.thinking}
          </p>
        )}

        {offersRevisit && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[copy.continueReply, copy.reviewReply].map((reply) => (
              <Button
                key={reply}
                variant="outline"
                size="sm"
                onClick={() => onQuickReply(reply)}
              >
                {reply}
              </Button>
            ))}
          </div>
        )}

        {notice && (
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        )}

        {error && (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>{readableChatError(error)}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

function UserMessage({
  message,
  regions,
  copy,
}: {
  message: TrailUIMessage;
  regions: Record<string, DropRegion>;
  copy: Copy;
}) {
  const text = messageText(message);
  const imageUrl = messageImageUrl(message);
  const imageId = message.metadata?.imageId;

  return (
    <li className="flex flex-col items-end gap-2">
      {imageUrl && (
        <DroppedImageView
          url={imageUrl}
          region={imageId ? regions[imageId] : undefined}
          copy={copy}
        />
      )}
      {text && (
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-secondary px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap text-secondary-foreground wrap-anywhere">
          {text}
        </p>
      )}
    </li>
  );
}

function AssistantMessage({
  message,
  copy,
}: {
  message: TrailUIMessage;
  copy: Copy;
}) {
  const callout = messageCallout(message);
  const text = messageText(message);

  return (
    <li className="flex flex-col gap-2">
      {callout && <TurnCalloutView callout={callout} copy={copy} />}
      {text && <ReplyText text={text} />}
    </li>
  );
}
