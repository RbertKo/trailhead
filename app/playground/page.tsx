import type { Metadata } from "next";

import { ChatPanel } from "@/components/playground/chat-panel";
import { ImagePanel } from "@/components/playground/image-panel";
import { SegmentPanel } from "@/components/playground/segment-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = {
  title: "API Playground",
};

export default function PlaygroundPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">API Playground</h1>
        <p className="text-sm text-muted-foreground">
          Exercises the Meta Model API routes. Every action here spends API
          credits.
        </p>
      </header>

      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="image">Image</TabsTrigger>
          <TabsTrigger value="segment">Segment</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="pt-4">
          <ChatPanel />
        </TabsContent>
        <TabsContent value="image" className="pt-4">
          <ImagePanel />
        </TabsContent>
        <TabsContent value="segment" className="pt-4">
          <SegmentPanel />
        </TabsContent>
      </Tabs>
    </main>
  );
}
