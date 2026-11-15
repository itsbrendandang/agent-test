// Pictures beside a research answer, as a search engine for science shows them: a small strip of the pictures the
// searches returned with their pages (Exa gives one for some web pages). Each picture links to its source page and
// names it. Nothing is fetched for them but the pictures themselves; a picture that does not load is left out, and
// an answer with no picture (also one recorded before pictures existed) shows no strip.
import { useState } from "react"
import { safeUrl } from "@/lib/words"
import { answerImages, type Source } from "./model"

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url } }

export function AnswerImages({ sources, onSource }: { sources: Source[]; onSource?: (n: number) => void }) {
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set())
  const shown = answerImages(sources).filter((s) => !broken.has(s.image) && safeUrl(s.url))
  if (!shown.length) return null
  return (
    <section className="answer-images" aria-label="Images from the sources">
      <ul>
        {shown.map((s) => (
          <li key={s.image}>
            <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer" title={s.title} onClick={() => onSource?.(s.n)}>
              <img src={s.image} alt={`Image from source ${s.n}: ${s.title}`} loading="lazy" decoding="async" referrerPolicy="no-referrer"
                onError={() => setBroken((before) => new Set(before).add(s.image))} />
              <span className="answer-image-credit small"><span className="source-n" aria-hidden="true">{s.n}</span> {hostOf(s.url)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
