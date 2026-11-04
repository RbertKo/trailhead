import { memo } from "react";
import ReactMarkdown from "react-markdown";

/** Raw HTML in a reply is shown as text: react-markdown does not render it. */
export const ReplyText = memo(function ReplyText({ text }: { text: string }) {
  return (
    <div className="trail-prose text-[15px]">
      <ReactMarkdown
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
