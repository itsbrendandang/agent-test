// The credit line of one source: where it was found, with a link to that search or database.
import { PROVIDERS } from "./providers"

/** The credit line of one source. A provider this page does not know is named as the engine named it, with no link. */
export function ProviderCredit({ provider }: { provider: string }) {
  const p = PROVIDERS[provider]
  if (!p) return provider ? <span className="search-credit" data-provider={provider}>Found in {provider}</span> : null
  if (!p.link || !p.linkText) return <span className="search-credit" data-provider={provider}>{p.label}</span>
  const [before, after] = p.label.split(p.linkText)
  return <span className="search-credit" data-provider={provider}>{before}<a href={p.link} target="_blank" rel="noopener noreferrer">{p.linkText}</a>{after}</span>
}
