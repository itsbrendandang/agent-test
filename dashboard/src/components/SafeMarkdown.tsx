// Markdown for text a model or the engine wrote: headings, lists, tables, code, links. The text is untrusted, so:
//  - raw HTML in it is never turned into elements (it is shown as the characters that were written);
//  - a link is a link only when it is http(s), and it opens in a new tab with rel="noopener noreferrer";
//  - an image is never loaded from the text: its description is shown instead;
//  - no plugin runs code from the text (no diagrams, no maths engine). Scientific notation is ordinary text:
//    "1.2 × 10⁻⁵", "IC50" and "p < 0.05" display as written.
// The caller may pass `inline`: private addresses ("#<key>-cite-2", "#<key>-check-0") that it put into the text
// itself, drawn as a citation chip or a check mark. The key is made by the caller for one render, so text from a
// model cannot produce one.
// `live`: the text is still arriving (an answer being written). Streamdown then reads it as a stream: an unfinished
// "**bold" or "[link" at the end is drawn as it will be, and a caret marks the end. Only for text that is really still
// coming: a finished text is drawn at once (static), never typed out.
import { type ComponentProps, type ReactNode, useMemo } from "react"
import { Streamdown } from "streamdown"
import { safeUrl } from "@/lib/words"

export interface Inline { key: string; cite: (n: number) => ReactNode; check: (index: number) => ReactNode }
const Image = ({ alt }: { alt?: string }) => <span className="md-noimage">[image not shown{alt ? `: ${alt}` : ""}]</span>
const NO_PLUGINS: [] = []

export function SafeMarkdown({ children, className = "", inline, live = false }: { children: string; className?: string; inline?: Inline; live?: boolean }) {
  const components = useMemo(() => {
    const own = inline ? new RegExp(`^#${inline.key}-(cite|check)-(\\d+)$`) : undefined
    function Link({ href, children: label }: { href?: string; children?: ReactNode }) {
      const mine = own && href ? own.exec(href) : null
      if (mine && inline) return <>{mine[1] === "cite" ? inline.cite(Number(mine[2])) : inline.check(Number(mine[2]))}</>
      const url = safeUrl(href)
      return url ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a> : <span data-blocked-link="">{label}</span>
    }
    return { a: Link, img: Image } as ComponentProps<typeof Streamdown>["components"]
  }, [inline])
  const allow = (url: string) => (inline && url.startsWith(`#${inline.key}-`) ? url : safeUrl(url) ?? "")
  return (
    <div className={`md ${className}`} data-live={live || undefined}>
      <Streamdown mode={live ? "streaming" : "static"} isAnimating={live} caret={live ? "block" : undefined} skipHtml rehypePlugins={NO_PLUGINS} components={components} linkSafety={{ enabled: false }} controls={false} urlTransform={allow}>{children}</Streamdown>
    </div>
  )
}
