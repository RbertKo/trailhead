import { memo } from "react";
import ReactMarkdown from "react-markdown";

/**
 * Raw HTML in a reply is shown as text: react-markdown does not render it. Images
 * are dropped: text injected through a thrown screenshot could otherwise make the
 * browser fetch a URL carrying the conversation, just by rendering the reply.
 */
export const ReplyText = memo(function ReplyText({ text }: { text: string }) {
  return (
    <div className="trail-prose text-[15px]">
      <ReactMarkdown
        disallowedElements={["img"]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
