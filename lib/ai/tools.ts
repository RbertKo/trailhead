import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";

// A topic-neutral sample that proves the tool loop works end to end.
// Replace it with real tools once the project topic is decided.
export const chatTools = {
  getCurrentTime: tool({
    description:
      "Get the current date and time in an IANA time zone, such as Asia/Seoul.",
    inputSchema: z.object({
      timeZone: z.string().describe("IANA time zone name"),
    }),
    execute: async ({ timeZone }) => ({
      timeZone,
      localTime: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        dateStyle: "medium",
        timeStyle: "long",
      }).format(new Date()),
    }),
  }),
};

export type ChatUIMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<typeof chatTools>
>;
