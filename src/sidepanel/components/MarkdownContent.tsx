import type { AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeSummaryMarkdown } from "../../lib/markdown";

export type MarkdownContentProps = {
  markdown: string;
  className?: string;
};

export function MarkdownContent({ markdown, className }: MarkdownContentProps) {
  const rootClassName = className ? `markdown-body ${className}` : "markdown-body";
  const normalizedMarkdown = normalizeSummaryMarkdown(markdown);

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children, ...props }) => {
            const anchorProps: AnchorHTMLAttributes<HTMLAnchorElement> = {
              ...props,
              href,
              target: "_blank",
              rel: "noreferrer"
            };
            return <a {...anchorProps}>{children}</a>;
          }
        }}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
