// "Try asking": a few questions for the question box, taken from what people search on Google right now.
// Source: Google Trends' public feed of trending searches (TRENDS_URL). It is free and needs no key. A keyword rule
// (no model, so no cost) keeps the searches about biology, medicine or health, and a template turns each one into
// a short question. The answer is kept for an hour. When the feed cannot be read, is empty or has nothing about
// biology, the list is filled from CURATED, so the row always has questions.
// A trend is someone's search, not a fact: the text is shortened, cleaned and shown as plain text.

export const TRENDS_URL = "https://trends.google.com/trending/rss?geo=US"
/** How long one reading of the feed is used (ms). */
export const TRENDING_TTL_MS = 60 * 60 * 1000
/** How long a failed reading is used before the feed is tried again (ms): the curated list meanwhile. */
export const TRENDING_RETRY_MS = 5 * 60 * 1000
export const TRENDING_TIMEOUT_MS = 4000
/** How many questions the row shows. */
export const TRENDING_COUNT = 4
const MAX_FEED_BYTES = 1_000_000
const MAX_TERM = 60

export interface TryQuestion {
  /** The question, as it goes in the box. */
  question: string
  /** A short label: the trending search, or the curated question's subject. */
  topic: string
  /** True when the question comes from a search trending on Google now. */
  trending: boolean
}
export interface TryAsking {
  /** "google-trends": at least one question is from the feed. "curated": none is (the feed failed or had nothing about biology). */
  source: "google-trends" | "curated"
  /** When the feed was read (ms since 1970); 0 when it was not read. */
  fetchedAt: number
  items: TryQuestion[]
}

/** Biology questions for when nothing trending is about biology. */
export const CURATED: TryQuestion[] = [
  { topic: "Vaccines", question: "How do mRNA vaccines train the immune system?", trending: false },
  { topic: "Microbiome", question: "What does the gut microbiome do for human health?", trending: false },
  { topic: "Gene editing", question: "How safe and precise is CRISPR gene editing in patients today?", trending: false },
  { topic: "Obesity drugs", question: "How do GLP-1 drugs like semaglutide cause weight loss?", trending: false },
  { topic: "Antibiotics", question: "Why is antibiotic resistance rising, and what can stop it?", trending: false },
]

// Words that make a search about biology, medicine or health. Whole words only. Words that are often something else
// are left out: "cell" (cell phone), "gene" (a first name), "aids" (hearing aids), "evolution".
const BIO_WORDS = [
  "virus", "viruses", "viral infection", "flu", "influenza", "bird flu", "h5n1", "measles", "mumps", "covid", "covid-19", "coronavirus", "rsv", "mpox",
  "monkeypox", "ebola", "hiv", "hepatitis", "polio", "tuberculosis", "malaria", "dengue", "zika", "west nile", "cholera", "norovirus", "whooping cough",
  "pertussis", "salmonella", "listeria", "e. coli", "e coli", "bacteria", "bacterial", "infection", "fungus", "fungal", "parasite", "lyme disease", "rabies",
  "outbreak", "pandemic", "epidemic", "vaccine", "vaccines", "vaccination", "antibiotic", "antibiotics", "cancer", "tumor", "tumour", "leukemia", "lymphoma",
  "melanoma", "chemotherapy", "immunotherapy", "diabetes", "insulin", "alzheimer's", "alzheimers", "alzheimer", "dementia", "parkinson's", "parkinson",
  "als", "stroke", "heart attack", "heart disease", "cholesterol", "blood pressure", "obesity", "autism", "adhd", "asthma", "allergy", "allergies",
  "ozempic", "wegovy", "mounjaro", "zepbound", "semaglutide", "tirzepatide", "glp-1", "statin", "statins", "tylenol", "acetaminophen", "fda",
  "cdc", "nih", "clinical trial", "genes", "genetic", "genome", "dna", "rna", "mrna", "crispr", "protein", "stem cell", "stem cells", "microbiome",
  "enzyme", "mutation", "biology", "neuroscience", "brain", "species", "fossil", "dinosaur", "disease", "syndrome", "symptoms", "medicine",
]
// Words that are biology in a search but often something else in a news headline ("a two-stroke lead", "fossil fuels",
// "protein bars"), and agency and brand names that headlines on stocks or politics often name ("FDA approves ...",
// "CDC director ..."). They count in the search's own words only, never from its news alone.
const AMBIGUOUS = new Set(["stroke", "fossil", "protein", "brain", "outbreak", "heart attack", "species", "dinosaur", "fda", "cdc", "nih", "tylenol"])
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const wordsRe = (words: string[], flags: string) =>
  new RegExp(`(?:^|[^\\p{L}\\p{N}])(${[...words].sort((a, b) => b.length - a.length).map(escape).join("|")})(?=$|[^\\p{L}\\p{N}])`, flags)
const BIO = wordsRe(BIO_WORDS, "iu")
const BIO_NEWS = wordsRe(BIO_WORDS.filter((w) => !AMBIGUOUS.has(w)), "iu")
const BIO_ALL = wordsRe(BIO_WORDS, "giu")
/** Small words that may sit between biology words ("bird flu and covid") without making the search about something else. */
const LINKS = new Set(["and", "or", "vs", "the", "of", "in", "a", "an", "for", "new", "symptoms", "cases", "&", "-", "+", "/"])

/** The biology word in a search, lower case; undefined when there is none. */
export function bioWord(text: string): string | undefined {
  return BIO.exec(text)?.[1]?.toLowerCase()
}
/** The biology word in a news headline, lower case. Ambiguous words do not count here. */
export const newsBioWord = (text: string): string | undefined => BIO_NEWS.exec(text)?.[1]?.toLowerCase()
/** True when a search has nothing but biology words (and small linking words): it names no person or other thing. */
export function onlyBio(text: string): boolean {
  const rest = text.toLowerCase().replace(BIO_ALL, " ").split(/\s+/).filter((w) => w && !LINKS.has(w))
  return rest.length === 0
}

/** XML text with its entities decoded and its spaces folded. */
function xmlText(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()
}

export interface Trend { term: string; news: string[] }

/** The trending searches in the feed, in its order: each search and the titles of the news about it. */
export function parseTrends(xml: string): Trend[] {
  const trends: Trend[] = []
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const term = xmlText(/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? "")
    if (!term) continue
    const news = [...item.matchAll(/<ht:news_item_title\b[^>]*>([\s\S]*?)<\/ht:news_item_title>/g)].map((m) => xmlText(m[1])).filter(Boolean)
    trends.push({ term, news })
  }
  return trends
}

/** A search's own words, made fit for a label: short, and with no characters a question box would choke on. */
const tidy = (term: string) => { const t = term.replace(/[<>{}[\]\\`]/g, "").trim(); return t.length > MAX_TERM ? `${t.slice(0, MAX_TERM - 1).trim()}…` : t }

/**
 * The questions the trending searches give. A search that is nothing but biology words ("measles outbreak") is asked
 * about as typed. A search that mixes biology with other words ("<a name> cancer") gives a question about its
 * biology word only. A search with no biology word, whose news has one, gives a question about that word. So a
 * person's name never appears in a question or its label.
 */
export function trendQuestions(trends: Trend[]): TryQuestion[] {
  const out: TryQuestion[] = []
  const seen = new Set<string>()
  for (const { term, news } of trends) {
    const label = tidy(term)
    if (!label) continue
    let subject: string | undefined
    if (bioWord(term)) subject = onlyBio(term) ? label : bioWord(term)
    else subject = news.map(newsBioWord).find((w) => w !== undefined)
    if (!subject) continue
    const question = `What does the latest science say about ${subject}?`
    if (seen.has(question.toLowerCase())) continue
    seen.add(question.toLowerCase())
    out.push({ question, topic: `Trending: ${subject}`, trending: true })
  }
  return out
}

/** Trending questions first, then curated ones, TRENDING_COUNT in all. */
export function tryAsking(trending: TryQuestion[], fetchedAt: number): TryAsking {
  const items = [...trending.slice(0, TRENDING_COUNT), ...CURATED].slice(0, TRENDING_COUNT)
  return { source: trending.length ? "google-trends" : "curated", fetchedAt, items }
}

/** A reply's text, reading no more than `max` bytes: a bigger feed is cut, not held in memory whole. */
async function readCapped(r: Response, max: number): Promise<string> {
  if (!r.body) return ""
  const reader = r.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < max) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  if (size >= max) await reader.cancel().catch(() => {})
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max))
}

export interface TrendingOptions {
  /** Tests: a fake fetch. No test reaches the network. */
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
  url?: string
}

/** The feed, read at most once an hour (once in five minutes after a failure). Never throws: a failure gives the curated list. */
export function createTrending(options: TrendingOptions = {}) {
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? TRENDING_TIMEOUT_MS
  const url = options.url ?? TRENDS_URL
  let cached: { value: TryAsking; until: number } | undefined
  let pending: Promise<TryAsking> | undefined

  async function read(): Promise<TryAsking> {
    const at = now()
    try {
      const r = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/rss+xml, application/xml, text/xml" } })
      if (!r.ok) throw new Error(`the trends feed answered ${r.status}`)
      const xml = await readCapped(r, MAX_FEED_BYTES)
      const value = tryAsking(trendQuestions(parseTrends(xml)), at)
      cached = { value, until: at + TRENDING_TTL_MS }
      return value
    } catch {
      const value = tryAsking([], 0)
      cached = { value, until: at + TRENDING_RETRY_MS }
      return value
    }
  }

  return {
    get(): Promise<TryAsking> {
      if (cached && now() < cached.until) return Promise.resolve(cached.value)
      pending ??= read().finally(() => { pending = undefined }) // requests that arrive together share one reading
      return pending
    },
  }
}
