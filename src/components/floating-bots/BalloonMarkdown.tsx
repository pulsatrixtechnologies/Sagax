// A reply in the desktop balloon, as the chat shows it: paragraphs, lists,
// bold and italics, inline code and code blocks, tables, quotes and links.
// The floating window fetches nothing and navigates nowhere, so an image
// shows as its description and a link as its text (its address on hover);
// "Open in Sagax" opens the whole thread.
import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ children, href }) => (
    <a href={href} title={href} className="fb-md-link" onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  ),
  img: ({ alt }) => (alt ? <span className="fb-md-img">[{alt}]</span> : null),
  table: ({ children }) => (
    <div className="fb-md-table">
      <table>{children}</table>
    </div>
  ),
};

/** Parsed again only when its text changes (the balloon redraws for every streamed word). */
export const BalloonMarkdown = memo(function BalloonMarkdown({ text }: { text: string }) {
  return (
    <div className="fb-md">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </Markdown>
    </div>
  );
});
