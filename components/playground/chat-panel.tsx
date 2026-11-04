"use client";

import { useChat } from "@ai-sdk/react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatUIMessage } from "@/lib/ai/tools";
import { readableChatError } from "@/lib/api/client";

type MessagePart = ChatUIMessage["parts"][number];

function MessagePartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case "text":
      return <p className="whitespace-pre-wrap">{part.text}</p>;
    case "reasoning":
      return part.text ? (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">Reasoning summary</summary>
          <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
        </details>
      ) : null;
    case "tool-getCurrentTime":
      return (
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <Badge variant="outline">getCurrentTime</Badge>
          {part.state === "output-available" && part.output.localTime}
          {part.state === "output-error" && part.errorText}
        </p>
      );
    default:
      return null;
  }
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop, error } =
    useChat<ChatUIMessage>();
  const busy = status === "submitted" || status === "streaming";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    void sendMessage({ text });
    setInput("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 text-sm" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {message.role === "user" ? "You" : "Muse Spark"}
            </span>
            {message.parts.map((part, index) => (
              <MessagePartView key={index} part={part} />
            ))}
          </div>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{readableChatError(error)}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask something, e.g. what time is it in Seoul?"
          aria-label="Message"
        />
        {busy ? (
          <Button type="button" variant="outline" onClick={() => stop()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}
