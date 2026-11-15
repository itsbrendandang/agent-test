"""Polite, cached HTTP for the dataset catalogue fetchers. Standard library only.

Rules this module enforces for every fetcher:

* one identified User-Agent, no credentials of any kind (no key, no token, no cookie, no login);
* robots.txt is fetched once per host and obeyed (RFC 9309 matching, with * and $);
* at most about 2 requests per second per host, slower where a host asks for it;
* every response is cached under /tmp/dataset-scout/cache, so a fetcher can be re-run and resumed;
* every real network request is written to /tmp/dataset-scout/requests.log (cache hits are not).

Nothing here reads .env, and nothing here writes inside the repository.
"""

from __future__ import annotations

import fcntl
import gzip
import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = Path(os.environ.get("DATASET_SCOUT_DIR", "/tmp/dataset-scout"))
CACHE = ROOT / "cache"
RECORDS = ROOT / "records"
REQUEST_LOG = ROOT / "requests.log"

UA_NAME = "drug-board-dataset-scout"
UA = os.environ.get(
    "DATASET_SCOUT_UA",
    UA_NAME + "/0.1 (metadata-only dataset catalogue; polite; +https://github.com/itsbrendandang)",
)

# Seconds between two requests to the same host. 0.6 s is about 1.7 requests per second.
DEFAULT_INTERVAL = 0.6
HOST_INTERVAL: Dict[str, float] = {
    # Slower than the default where the provider publishes a lower limit for anonymous use.
    "zenodo.org": 2.1,  # guests: 30 search requests per minute
    "datadryad.org": 2.1,  # anonymous: 30 requests per minute
    "api.github.com": 2.0,  # anonymous: 60 requests per hour; see GITHUB_API_BUDGET
    "eutils.ncbi.nlm.nih.gov": 0.5,  # 3 per second without a key; we stay at 2
    "api.crossref.org": 0.6,
    "huggingface.co": 0.7,
    "www.openml.org": 1.0,
    "api.figshare.com": 1.0,
}
MAX_CRAWL_DELAY = 600.0  # depmap.org asks for 500 s; we wait
MAX_BYTES = 64 * 1024 * 1024  # refuse to read more than this: we collect metadata, not data
TIMEOUT = 60

# robots.txt policy. A provider's robots.txt is written for crawlers, and several providers
# disallow their own documented API path there (NCBI E-utilities, PubChem PUG REST, RCSB data API,
# ClinicalTrials.gov API, Zenodo REST API, ENCODE search, GTEx, STRING, Reactome ContentService,
# the EBI and NCBI FTP sites). We do NOT override robots.txt for them: a disallowed URL is refused
# and the source is reported as blocked, so the fetchers use another official route (DataCite, a
# licence page, a registry). A person who decides that a provider's API terms take precedence may
# list the API host here, with the documentation that invites programmatic use. It is empty on
# purpose.
ROBOTS_EXEMPT_API_HOSTS: Dict[str, str] = {}

# These scripts were first run by an AI coding agent. Where a site's robots.txt has a group for
# AI agents or AI crawlers, that group is obeyed as well as the group for "*". A person who runs
# a fetcher by hand may say so with DATASET_SCOUT_OPERATOR=human; then only the "*" group (or a
# group for our own name) applies. An AI agent must never set that variable.
AI_AGENT_NAMES = ("claude-user", "claude-web", "claudebot", "anthropic-ai", "gptbot", "chatgpt-user", "oai-searchbot")


def operator_is_ai() -> bool:
    return os.environ.get("DATASET_SCOUT_OPERATOR", "").strip().lower() != "human"


class HttpError(Exception):
    def __init__(self, status: int, url: str, note: str = "") -> None:
        super().__init__(f"HTTP {status} for {url} {note}".strip())
        self.status = status
        self.url = url


class RobotsDisallowed(Exception):
    def __init__(self, url: str) -> None:
        super().__init__(f"robots.txt disallows {url}")
        self.url = url


class Fetched:
    __slots__ = ("url", "status", "headers", "body", "fetched_at", "from_cache")

    def __init__(
        self,
        url: str,
        status: int,
        headers: Dict[str, str],
        body: bytes,
        fetched_at: str,
        from_cache: bool,
    ) -> None:
        self.url = url
        self.status = status
        self.headers = headers
        self.body = body
        self.fetched_at = fetched_at
        self.from_cache = from_cache

    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8", errors="replace"))


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(*parts: Any) -> None:
    print(*parts, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------------------------
# robots.txt (RFC 9309)
# ---------------------------------------------------------------------------------------------


class Robots:
    """A small RFC 9309 matcher. The standard library's parser ignores * and $ in paths."""

    def __init__(self, text: str) -> None:
        self.groups: List[Tuple[List[str], List[Tuple[str, str]], Optional[float]]] = []
        agents: List[str] = []
        rules: List[Tuple[str, str]] = []
        delay: Optional[float] = None
        seen_rule = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            key, value = line.split(":", 1)
            key, value = key.strip().lower(), value.strip()
            if key == "user-agent":
                if seen_rule:
                    self.groups.append((agents, rules, delay))
                    agents, rules, delay, seen_rule = [], [], None, False
                agents.append(value.lower())
            elif key in ("allow", "disallow"):
                seen_rule = True
                if agents:
                    rules.append((key, value))
            elif key == "crawl-delay":
                seen_rule = True
                try:
                    delay = float(value)
                except ValueError:
                    pass
        if agents:
            self.groups.append((agents, rules, delay))

    def _group(self, token: str) -> Tuple[List[Tuple[str, str]], Optional[float]]:
        token = token.lower()
        named: List[Tuple[str, str]] = []
        named_delay: Optional[float] = None
        found = False
        star: List[Tuple[str, str]] = []
        star_delay: Optional[float] = None
        for agents, rules, delay in self.groups:
            if any(a != "*" and a and (a == token or token.startswith(a)) for a in agents):
                found = True
                named.extend(rules)
                named_delay = delay if delay is not None else named_delay
            elif "*" in agents:
                star.extend(rules)
                star_delay = delay if delay is not None else star_delay
        return (named, named_delay) if found else (star, star_delay)

    @staticmethod
    def _matches(pattern: str, path: str) -> bool:
        anchored = pattern.endswith("$")
        if anchored:
            pattern = pattern[:-1]
        regex = "".join(".*" if ch == "*" else re.escape(ch) for ch in pattern)
        return re.match(regex + ("$" if anchored else ""), path) is not None

    def allowed(self, token: str, url: str) -> bool:
        parts = urllib.parse.urlsplit(url)
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        if path == "/robots.txt":
            return True
        rules, _ = self._group(token)
        best_len, best_allow = -1, True
        for kind, pattern in rules:
            if not pattern:  # "Disallow:" with no value allows everything
                continue
            if self._matches(pattern, path):
                length = len(pattern)
                allow = kind == "allow"
                if length > best_len or (length == best_len and allow):
                    best_len, best_allow = length, allow
        return best_allow

    def crawl_delay(self, token: str) -> Optional[float]:
        return self._group(token)[1]


_ROBOTS: Dict[str, Optional[Robots]] = {}


def robots_for(scheme: str, host: str) -> Optional[Robots]:
    """The parsed robots.txt of a host, or None when the host has none (4xx)."""
    key = scheme + "://" + host
    if key in _ROBOTS:
        return _ROBOTS[key]
    url = key + "/robots.txt"
    try:
        got = fetch(url, check_robots=False, ok_statuses=(200, 400, 401, 403, 404, 410))
    except Exception as err:  # unreachable or 5xx: RFC 9309 says assume complete disallow
        log(f"robots: {url} unreachable ({err}); treating host as disallowed")
        _ROBOTS[key] = Robots("User-agent: *\nDisallow: /\n")
        return _ROBOTS[key]
    if got.status != 200:
        _ROBOTS[key] = None
        return None
    text = got.text()
    if "<html" in text[:2000].lower():  # an HTML page served for robots.txt is not a robots file
        _ROBOTS[key] = None
        return None
    _ROBOTS[key] = Robots(text)
    return _ROBOTS[key]


def robots_allows(url: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    robots = robots_for(parts.scheme, parts.netloc)
    if robots is None:
        return True
    if not robots.allowed(UA_NAME, url):
        return False
    if not operator_is_ai():
        return True
    return all(robots.allowed(token, url) for token in AI_AGENT_NAMES)


# ---------------------------------------------------------------------------------------------
# Rate limit, cache, request log
# ---------------------------------------------------------------------------------------------


def _interval(scheme: str, host: str, check_robots: bool) -> float:
    base = HOST_INTERVAL.get(host, DEFAULT_INTERVAL)
    if check_robots:
        robots = _ROBOTS.get(scheme + "://" + host)
        delay = robots.crawl_delay(UA_NAME) if robots else None
        if delay:
            base = max(base, min(delay, MAX_CRAWL_DELAY))
    return base


def _gate(host: str, interval: float) -> None:
    """Wait until this host may be called again. The lock makes it hold across processes."""
    gate_dir = CACHE / "_hosts"
    gate_dir.mkdir(parents=True, exist_ok=True)
    with open(gate_dir / (host.replace(":", "_") + ".last"), "a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.seek(0)
        raw = handle.read().strip()
        last = float(raw) if raw else 0.0
        wait = last + interval - time.time()
        if wait > 0:
            time.sleep(wait)
        handle.seek(0)
        handle.truncate()
        handle.write(repr(time.time()))
        handle.flush()
        fcntl.flock(handle, fcntl.LOCK_UN)


def _touch(host: str) -> None:
    try:
        with open(CACHE / "_hosts" / (host.replace(":", "_") + ".last"), "w") as handle:
            handle.write(repr(time.time()))
    except OSError:
        pass


def _cache_paths(method: str, url: str, data: Optional[bytes]) -> Tuple[Path, Path]:
    host = urllib.parse.urlsplit(url).netloc.replace(":", "_")
    digest = hashlib.sha256(
        (method + " " + url + "\n").encode("utf-8") + (data or b"")
    ).hexdigest()[:32]
    folder = CACHE / host
    folder.mkdir(parents=True, exist_ok=True)
    return folder / (digest + ".meta.json"), folder / (digest + ".body")


def _log_request(method: str, url: str, status: Any, size: int) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    with open(REQUEST_LOG, "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.write(
            "\t".join(
                [now_iso(), method, urllib.parse.urlsplit(url).netloc, str(status), str(size), url]
            )
            + "\n"
        )
        fcntl.flock(handle, fcntl.LOCK_UN)


def request_count() -> int:
    try:
        with open(REQUEST_LOG) as handle:
            return sum(1 for _ in handle)
    except OSError:
        return 0


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects are followed by fetch() itself, one hop at a time, so that robots.txt and the
    rate limit of the host we are sent to are checked before the next request."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


_OPENER = urllib.request.build_opener(_NoRedirect())
MAX_REDIRECTS = 5


def _is_cert_error(err: Exception) -> bool:
    reason = getattr(err, "reason", err)
    return isinstance(reason, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(err)


def _curl(
    url: str, method: str, data: Optional[bytes], headers: Dict[str, str], max_bytes: int
) -> Tuple[int, Dict[str, str], bytes]:
    """Fetch with the system curl. Used only when Python cannot build the certificate chain.

    Some servers do not send their intermediate certificate. OpenSSL then fails, while the system
    curl checks the chain against the system trust store. Verification is never turned off.
    """
    with tempfile.TemporaryDirectory(prefix="dataset-scout-curl-") as folder:
        head_path, body_path = os.path.join(folder, "head"), os.path.join(folder, "body")
        command = [
            "curl", "--silent", "--show-error", "--compressed", "--proto", "=http,https",
            "--max-time", str(TIMEOUT), "--max-filesize", str(max_bytes),
            "--request", method, "--dump-header", head_path, "--output", body_path,
            "--write-out", "%{http_code}",
        ]
        for key, value in headers.items():
            if key.lower() != "accept-encoding":
                command += ["--header", f"{key}: {value}"]
        if data is not None:
            command += ["--data-binary", "@-"]
        command.append(url)
        done = subprocess.run(command, input=data, capture_output=True, timeout=TIMEOUT + 15)
        if done.returncode != 0:
            raise OSError("curl: " + done.stderr.decode("utf-8", "replace").strip()[:200])
        status = int(done.stdout.decode().strip()[-3:])
        reply_headers: Dict[str, str] = {}
        if os.path.exists(head_path):
            with open(head_path, encoding="latin-1") as handle:
                for line in handle:
                    if line.startswith("HTTP/"):
                        reply_headers = {}  # keep only the last block (after redirects)
                    elif ":" in line:
                        key, value = line.split(":", 1)
                        reply_headers[key.strip().lower()] = value.strip()
        reply_headers.pop("content-encoding", None)  # curl already decoded the body
        body = b""
        if os.path.exists(body_path):
            with open(body_path, "rb") as handle:
                body = handle.read(max_bytes + 1)
        return status, reply_headers, body


ROBOTS_REFUSED = -1  # cache status of a URL that robots.txt did not let us read


def _store_refusal(meta_path: Path, body_path: Path, url: str, method: str, refused_url: str) -> None:
    """Remember a robots.txt refusal, so that a later run from the cache gives the same result
    and never uses an older copy of the page."""
    body_path.write_bytes(b"")
    meta_path.write_text(
        json.dumps({"url": url, "method": method, "status": ROBOTS_REFUSED, "headers": {},
                    "fetched_at": now_iso(), "refused_url": refused_url})
    )


def fetch(
    url: str,
    method: str = "GET",
    data: Optional[bytes] = None,
    headers: Optional[Dict[str, str]] = None,
    check_robots: bool = True,
    refresh: bool = False,
    ok_statuses: Iterable[int] = (200,),
    max_bytes: int = MAX_BYTES,
    retries: int = 3,
) -> Fetched:
    """GET or POST a URL politely. Returns the cached copy when there is one.

    A status listed in ok_statuses is returned (and cached). Any other status raises HttpError.
    429 and 5xx are retried with a growing pause and are never cached.
    """
    ok = tuple(ok_statuses)
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValueError(f"not an http(s) URL: {url}")
    meta_path, body_path = _cache_paths(method, url, data)
    if not refresh and os.environ.get("DATASET_SCOUT_REFRESH") != "1":
        if meta_path.exists() and body_path.exists():
            meta = json.loads(meta_path.read_text())
            if meta["status"] == ROBOTS_REFUSED:
                raise RobotsDisallowed(meta.get("refused_url") or url)
            if meta["status"] in ok:
                return Fetched(
                    url, meta["status"], meta["headers"], body_path.read_bytes(), meta["fetched_at"], True
                )
            raise HttpError(meta["status"], url, "(cached)")
    if os.environ.get("DATASET_SCOUT_OFFLINE") == "1":
        raise HttpError(0, url, "(offline mode and not in the cache)")
    if check_robots and parts.netloc not in ROBOTS_EXEMPT_API_HOSTS and not robots_allows(url):
        _store_refusal(meta_path, body_path, url, method, url)
        raise RobotsDisallowed(url)

    send = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}
    send.update(headers or {})
    pause = 5.0
    last_error: Optional[Exception] = None
    current, current_method, current_data = url, method, data
    hops = 0
    attempt = 0
    while True:
        here = urllib.parse.urlsplit(current)
        _gate(here.netloc, _interval(here.scheme, here.netloc, check_robots))
        request = urllib.request.Request(current, data=current_data, method=current_method, headers=send)
        status: int
        raw = b""
        reply_headers: Dict[str, str] = {}
        try:
            with _OPENER.open(request, timeout=TIMEOUT) as reply:
                status = reply.status
                reply_headers = {k.lower(): v for k, v in reply.headers.items()}
                raw = reply.read(max_bytes + 1)
        except urllib.error.HTTPError as err:
            status = err.code
            reply_headers = {k.lower(): v for k, v in (err.headers or {}).items()}
            try:
                raw = err.read(max_bytes + 1)
            except Exception:
                raw = b""
        except Exception as err:  # DNS, TLS, timeout, reset
            failure: Optional[Exception] = err
            if _is_cert_error(err):
                try:
                    status, reply_headers, raw = _curl(current, current_method, current_data, send, max_bytes)
                    failure = None
                except Exception as curl_err:
                    failure = curl_err
            if failure is not None:
                _log_request(current_method, current, type(failure).__name__, 0)
                _touch(here.netloc)
                last_error = failure
                attempt += 1
                if attempt <= retries:
                    time.sleep(pause)
                    pause *= 2
                    continue
                raise HttpError(0, url, f"({type(failure).__name__}: {failure})") from failure
        _touch(here.netloc)
        _log_request(current_method, current, status, len(raw))
        if status in (301, 302, 303, 307, 308) and reply_headers.get("location"):
            hops += 1
            target = urllib.parse.urljoin(current, reply_headers["location"])
            there = urllib.parse.urlsplit(target)
            if hops > MAX_REDIRECTS or there.scheme not in ("http", "https"):
                raise HttpError(status, url, f"(redirect not followed: {target[:120]})")
            if check_robots and there.netloc not in ROBOTS_EXEMPT_API_HOSTS and not robots_allows(target):
                _store_refusal(meta_path, body_path, url, method, target)
                raise RobotsDisallowed(target)
            if status == 303 or (status in (301, 302) and current_method == "POST"):
                current_method, current_data = "GET", None
            current = target
            continue
        if len(raw) > max_bytes:
            raise HttpError(status, url, f"(reply larger than {max_bytes} bytes; refusing bulk data)")
        encoding = reply_headers.get("content-encoding", "").lower()
        try:
            if encoding == "gzip":
                raw = gzip.decompress(raw)
            elif encoding == "deflate":
                raw = zlib.decompress(raw)
        except Exception:
            pass
        if status == 429 or status >= 500:
            last_error = HttpError(status, url)
            attempt += 1
            if attempt <= retries:
                wait = pause
                retry_after = reply_headers.get("retry-after", "")
                if retry_after.isdigit():
                    wait = max(wait, min(float(retry_after), 300.0))
                log(f"  {status} from {here.netloc}; waiting {wait:.0f}s")
                time.sleep(wait)
                pause *= 2
                continue
            raise last_error
        keep = {
            k: v
            for k, v in reply_headers.items()
            if k in ("content-type", "last-modified", "link", "etag", "x-total-count", "x-uniprot-release",
                     "x-uniprot-release-date", "x-total-results", "x-ratelimit-remaining", "content-length")
        }
        if current != url:
            keep["x-final-url"] = current
        fetched_at = now_iso()
        body_path.write_bytes(raw)
        meta_path.write_text(
            json.dumps(
                {"url": url, "method": method, "status": status, "headers": keep, "fetched_at": fetched_at}
            )
        )
        if status not in ok:
            raise HttpError(status, url)
        return Fetched(url, status, keep, raw, fetched_at, False)


def cached_at(url: str, method: str = "GET") -> Optional[str]:
    """When the cache entry of a URL was written (a reply or a robots.txt refusal), or None."""
    meta_path, _ = _cache_paths(method, url, None)
    try:
        return json.loads(meta_path.read_text()).get("fetched_at")
    except (OSError, ValueError):
        return None


def get_json(url: str, **kwargs: Any) -> Tuple[Any, Fetched]:
    headers = dict(kwargs.pop("headers", None) or {})
    headers.setdefault("Accept", "application/json")
    got = fetch(url, headers=headers, **kwargs)
    return got.json(), got


def post_json(url: str, payload: Any, **kwargs: Any) -> Tuple[Any, Fetched]:
    headers = dict(kwargs.pop("headers", None) or {})
    headers.setdefault("Accept", "application/json")
    headers.setdefault("Content-Type", "application/json")
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    got = fetch(url, method="POST", data=body, headers=headers, **kwargs)
    return got.json(), got


# ---------------------------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------------------------


def clean_text(value: Any, limit: int = 300) -> str:
    """One line of plain text, cut at a word boundary. HTML tags and Markdown noise are removed."""
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]{0,2000}>", " ", text)
    text = (
        text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    )
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)  # Markdown images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # Markdown links keep their text
    text = re.sub(r"[#*_`>|]+", " ", text)
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut[limit // 2 :]:
        cut = cut[: cut.rindex(" ")]
    return cut.rstrip(" ,;:.-") + "…"


# Text from a dataset card or a registry is written by third parties. Some of it speaks to the
# reader ("install this plugin in your coding agent", "pip install ..."). Such text must not
# reach an agent as if it were a description, so it is replaced by a neutral line.
_INSTRUCTION = re.compile(
    r"\b(your (coding )?agents?|coding agents?|as an ai\b|ignore (all |any )?(previous|prior|above)|system prompt"
    r"|you (must|should|are an?)\b|pip3? install|npx |npm install|curl |wget |run the following"
    r"|\binstall (it|the|this|our|hugging ?face)\b|conda (install|environment)|quickstart"
    r"|execute the|sudo |api[_ -]?key|click here|sign up|subscribe)",
    re.I,
)


def is_instruction_like(text: Optional[str]) -> bool:
    return bool(text and _INSTRUCTION.search(text))


def safe_description(text: str, fallback: str) -> str:
    """The description, or the fallback when the text reads like instructions to the reader."""
    return fallback if is_instruction_like(text) or not text else text


def human_size(num_bytes: Any) -> Optional[str]:
    try:
        size = float(num_bytes)
    except (TypeError, ValueError):
        return None
    if size <= 0:
        return None
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if size < 1000 or unit == "PB":
            return f"{size:.0f} {unit}" if unit == "B" or size >= 100 else f"{size:.1f} {unit}"
        size /= 1000
    return None


def write_records(source: str, records: List[Dict[str, Any]], drops: Optional[Dict[str, int]] = None) -> Path:
    """Write one source's records, sorted by id, to /tmp/dataset-scout/records/<source>.jsonl.

    drops holds how many records the boundary rules refused; it goes to <source>.drops.json so
    that the build can report it.
    """
    RECORDS.mkdir(parents=True, exist_ok=True)
    path = RECORDS / (source + ".jsonl")
    ordered = sorted(records, key=lambda r: r["id"])
    with open(path, "w", encoding="utf-8") as handle:
        for record in ordered:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    (RECORDS / (source + ".drops.json")).write_text(json.dumps(drops or {}, sort_keys=True))
    log(f"{source}: wrote {len(ordered)} records to {path}; boundary rules refused {drops or {}}")
    return path


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                out.append(json.loads(line))
    return out
