import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatInlineSteps } from "@maintenance/api-client/chat-format";
export { formatInlineSteps } from "@maintenance/api-client/chat-format";
import styles from "./document-assistant.module.css";

export function ChatReply({
  text,
  citations,
}: {
  text: string;
  citations?: ReactNode;
}) {
  return (
    <div className={styles.replyContent}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={[
          "p",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "strong",
          "em",
          "del",
          "ul",
          "ol",
          "li",
          "blockquote",
          "pre",
          "code",
          "br",
          "hr",
          "a",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
        ]}
        unwrapDisallowed
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          h4: ({ children }) => <h3>{children}</h3>,
          h5: ({ children }) => <h3>{children}</h3>,
          h6: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          table: ({ children }) => (
            <div
              className={styles.replyTable}
              tabIndex={0}
              role="region"
              aria-label="Answer table"
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {formatInlineSteps(text)}
      </Markdown>
      {citations && <span className={styles.pointCitations}>{citations}</span>}
    </div>
  );
}
