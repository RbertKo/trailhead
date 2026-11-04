import { memo } from "react";
import ReactMarkdown from "react-markdown";

/**
 * Raw HTML in a reply is shown as text: react-markdown does not render it. Images
 * and links are reduced to their text: words injected through a thrown screenshot
 * could otherwise get a URL carrying the conversation fetched or clicked.
 */
export const ReplyText = memo(function ReplyText({ text }: { text: string }) {
  return (
    <div className="trail-prose text-[15px]">
      <ReactMarkdown disallowedElements={["img", "a"]} unwrapDisallowed>
        {text}
      </ReactMarkdown>
    </div>
  );
});
