// Markdown for text a model or the engine wrote: headings, lists, tables, code, links. The text is untrusted, so:
//  - raw HTML in it is never turned into elements (it is shown as the characters that were written);
//  - a link is a link only when it is http(s), and it opens in a new tab with rel="noopener noreferrer";
//  - an image is never loaded from the text: its description is shown instead;
//  - no plugin runs code from the text (no diagrams, no maths engine). Scientific notation is ordinary text:
//    "1.2 × 10⁻⁵", "IC50" and "p < 0.05" display as written.
import type { ComponentProps, ReactNode } from "react"
import { Streamdown } from "streamdown"
import { safeUrl } from "@/lib/words"

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  const url = safeUrl(href)
  return url ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <span data-blocked-link="">{children}</span>
}
const Image = ({ alt }: { alt?: string }) => <span className="md-noimage">[image not shown{alt ? `: ${alt}` : ""}]</span>

const COMPONENTS = { a: Link, img: Image } as ComponentProps<typeof Streamdown>["components"]
const NO_PLUGINS: [] = []

export function SafeMarkdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <Streamdown mode="static" skipHtml rehypePlugins={NO_PLUGINS} components={COMPONENTS} linkSafety={{ enabled: false }} controls={false}
        urlTransform={(url) => safeUrl(url) ?? ""}>{children}</Streamdown>
    </div>
  )
}
