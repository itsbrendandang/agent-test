#!/usr/bin/env python3
"""Checks against the deployed app. Practice (scripted) reviews only; nothing here can cost API money.

  python3 deploy/modal_host/tests/cloud_check.py <address> refused        every path without a session -> 401
  python3 deploy/modal_host/tests/cloud_check.py <address> demo           signed in: the engine is in Demo, locked, with no key
  python3 deploy/modal_host/tests/cloud_check.py <address> features       the chat, a plan, the plan's review, search, Ask, the lists
  python3 deploy/modal_host/tests/cloud_check.py <address> start          start a practice review, print its id
  python3 deploy/modal_host/tests/cloud_check.py <address> wait <id> [n]  wait until the review has n events (default: until done)
  python3 deploy/modal_host/tests/cloud_check.py <address> show [<id>]    runs, or one run's event counts
  python3 deploy/modal_host/tests/cloud_check.py <address> digest <id>    a hash of the run's event log and memo

The access code is read from deploy/modal_host/.local/codes/<ASB_CHECK_USER or tester>.txt and never printed.
Standard library only.
"""
from __future__ import annotations

import collections
import hashlib
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LOCAL = Path(__file__).resolve().parents[1] / ".local"
BRIEF = "kras-g12c-hit-to-lead.md"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


class Client:
    def __init__(self, base: str, signed_in: bool) -> None:
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect)
        if signed_in:
            code = (LOCAL / "codes" / f"{os.environ.get('ASB_CHECK_USER', 'tester')}.txt").read_text().strip()
            status, _, _ = self.call("/login", form={"code": code}, timeout=180)
            if status != 303:
                sys.exit(f"sign-in failed with status {status}")

    def call(self, path: str, *, method: str | None = None, body: object = None, form: dict | None = None, headers: dict | None = None, timeout: float = 60, limit: int = 1 << 22) -> tuple[int, dict, bytes]:
        data = json.dumps(body).encode() if body is not None else urllib.parse.urlencode(form).encode() if form is not None else None
        head = {"content-type": "application/json"} if body is not None else {"content-type": "application/x-www-form-urlencoded"} if form is not None else {}
        request = urllib.request.Request(self.base + path, data=data, method=method, headers={**head, **(headers or {})})
        try:
            with self.opener.open(request, timeout=timeout) as answer:
                return answer.status, dict(answer.headers), answer.read(limit)
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read(limit)

    def json(self, path: str, **kw) -> object:  # noqa: ANN003
        status, _, data = self.call(path, **kw)
        if status >= 300:
            sys.exit(f"{path} answered {status}: {data[:300]!r}")
        return json.loads(data)

    def events(self, run: str) -> list[dict]:
        """The run's event log, read from the event stream until it goes quiet."""
        request = urllib.request.Request(f"{self.base}/api/runs/{run}/events", headers={"accept": "text/event-stream"})
        out: list[dict] = []
        try:
            with self.opener.open(request, timeout=4) as answer:
                if answer.status != 200:
                    return out
                for raw in answer:
                    if raw.startswith(b"data: "):
                        out.append(json.loads(raw[6:]))
        except (TimeoutError, OSError):
            pass  # the stream stays open; a quiet four seconds ends the read
        return out


def refused(base: str) -> None:
    inside = Client(base, signed_in=True)
    _, _, shell = inside.call("/")
    assets = sorted({part.split('"')[0] for part in shell.decode().split('"/assets/')[1:]})[:3]
    runs = inside.json("/api/runs")
    run = runs[0]["id"] if runs else "no-such-run"
    found = [r["id"] for r in inside.json("/api/search?q=sotorasib", headers={"Sec-Fetch-Site": "same-origin"}) if isinstance(r, dict) and str(r.get("id", "")).startswith("a-")]
    answer = found[0] if found else "a-00000000000000-00000000"
    gets = ["/", "/index.html", "/favicon.png", "/icons.svg", *[f"/assets/{a}" for a in assets], "/board", "/logout", "/login", "/BUILD.json", "/.env", "/..%2f..%2fapp%2fglhf%2fruns%2f.token", "/%2e%2e/%2e%2e/app/glhf/runs/.token",
            "/api/status", "/api/paid", "/api/roster", "/api/briefs", "/api/runs", f"/api/runs/{run}/events", f"/api/runs/{run}/memo", "/api/search?q=kras", "/api/token",
            "/api/chat/catalog", "/api/research", f"/api/research/{answer}", f"/api/research/{answer}/events", "/api/glhf/status", "/api/glhf/roles", "/api/glhf/runs", "/api/glhf/scoreboard", "/api/bixv1/runs", "/api/bixv1/scoreboard", "/api/nothing"]
    posts = ["/api/runs", f"/api/runs/{run}/resume", "/api/paid", "/api/ask", "/api/research", "/api/chat", "/api/chat/plans/x/start", "/api/glhf/runs", f"/api/glhf/runs/{run}/cancel", "/logout", "/"]
    outside = Client(base, signed_in=False)
    forged = {"cookie": "__Host-asb_session=owner.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
    failures, checked = [], 0
    # What a signed-in person gets for each GET path: none of it may appear in a refusal.
    real: dict[str, bytes] = {}
    for path in gets:
        if path.endswith("/events"):
            continue
        status, _, data = inside.call(path, headers={"Sec-Fetch-Site": "same-origin"} if path.startswith("/api/") else {"accept": "text/html"})
        if status == 200 and len(data) >= 64:
            real[path] = data[len(data) // 2: len(data) // 2 + 64]
    for label, headers in (("no cookie", {}), ("forged cookie", forged), ("browser page visit", {"accept": "text/html"}), ("Modal proxy headers", {"Modal-Key": "wk-x", "Modal-Secret": "ws-x", "Authorization": "Bearer x"})):
        for method, paths in (("GET", gets), ("HEAD", gets[:8]), ("POST", posts), ("OPTIONS", ["/api/runs", "/"]), ("PUT", ["/api/runs"]), ("DELETE", [f"/api/runs/{run}"])):
            for path in paths:
                status, head, data = outside.call(path, method=method, body={} if method in ("POST", "PUT") else None, headers=headers)
                checked += 1
                leaked = (path in real and real[path] in data) or any(mark in data for mark in (b'"mock"', b"<div id=\"root\"", b"runId", b"data: {", b"<script"))
                if status != 401 or leaked or head.get("Set-Cookie"):
                    failures.append(f"{label}: {method} {path} -> {status}{' LEAKED' if leaked else ''}")
    print(f"refused: {checked} requests without a valid session; {len(failures)} not refused")
    print(f"  signed in, {len(real)} of those GET paths return content; none of it was in a refusal")
    print(f"  paths: {len(gets)} GET (app files: /, {len(assets)} real asset files, favicon; API: every engine route; the event streams of run {run} and answer {answer}), {len(posts)} POST, plus HEAD, OPTIONS, PUT, DELETE")
    for line in failures:
        print("  FAIL", line)
    # And with a session, but from another site's page:
    cross = 0
    for headers in ({"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site", "Origin": "https://someone--else.modal.run"}, {"Origin": "https://evil.example"}):
        for method, path in (("GET", "/api/runs"), ("GET", f"/api/runs/{run}/events"), ("POST", "/api/runs")):
            status, _, _ = inside.call(path, method=method, body={"brief": BRIEF} if method == "POST" else None, headers=headers)
            cross += 1
            if status != 403:
                failures.append(f"cross-site with session: {method} {path} {headers} -> {status}")
                print("  FAIL", failures[-1])
    print(f"refused: {cross} signed-in requests sent as if from another site's page -> 403")
    sys.exit(1 if failures else 0)


def demo(base: str) -> None:
    client = Client(base, signed_in=True)
    status = client.json("/api/status")
    paid = client.json("/api/paid")
    print("status:", {k: status[k] for k in ("mock", "paidCalls", "paidSource", "paidLocked", "keys")})
    print("paid:", {k: paid[k] for k in ("paid", "source", "locked", "board")})
    ok = status["mock"] is True and status["paidCalls"] is False and status["paidLocked"] is True and not any(status["keys"].values()) and paid["locked"] is True and paid["board"] == "scripted"
    code, _, data = client.call("/api/paid", body={"on": False})  # only ever "off": an agent never asks for "on". The engine wants its own token even for this
    print("POST /api/paid {on: false} without the engine's session token ->", code, json.loads(data).get("field"))
    code2, _, data2 = client.call("/api/glhf/runs", body={"solver": "glhf", "model": "mock"})
    print("POST /api/glhf/runs ->", code2, json.loads(data2).get("error", "")[:90])
    sys.exit(0 if ok and code == 401 and code2 == 501 else 1)


def features(base: str) -> None:
    """What the hosted app is for, through the same calls the pages make. Scripted only."""
    client = Client(base, signed_in=True)
    page = {"Sec-Fetch-Site": "same-origin"}
    ok = True

    def line(name: str, good: bool, detail: str = "") -> None:
        nonlocal ok
        ok = ok and good
        print(f"{'ok  ' if good else 'FAIL'} {name}{': ' + detail if detail else ''}")

    catalog = client.json("/api/chat/catalog", headers=page)
    line("catalog", catalog["paidCalls"] is False and len(catalog["agents"]) > 5, f"{len(catalog['agents'])} agents, {len(catalog.get('skills', []))} skills, paid calls {catalog['paidCalls']}")
    roster = client.json("/api/roster", headers=page)
    briefs = client.json("/api/briefs", headers=page)
    line("roster and briefs", len(roster) >= 5 and len(briefs) >= 1, f"{len(roster)} members, briefs {briefs}")
    status, _, data = client.call("/api/chat", body={"messages": [{"role": "user", "content": "Should we advance a KRAS G12C hit that has a hERG problem?"}]}, headers=page)
    reply = json.loads(data)
    plan = reply.get("plan") or {}
    line("chat drafts a plan and starts nothing", status == 200 and bool(plan.get("id")) and reply.get("mode") == "scripted", f"mode {reply.get('mode')}, {len(plan.get('agents', []))} agents, paid {plan.get('paid')}")
    before = len(client.json("/api/runs"))
    status, _, data = client.call(f"/api/chat/plans/{plan.get('id')}/start", body={"confirm": True}, headers=page)
    started = json.loads(data)
    run = started.get("id", "")
    line("confirming the plan starts one practice review", status == 201 and bool(run), f"{status} {run}")
    status2, _, _ = client.call(f"/api/chat/plans/{plan.get('id')}/start", body={"confirm": True}, headers=page)
    line("confirming the same plan again starts no second review", status2 == 409 and len(client.json("/api/runs")) == before + 1, str(status2))
    deadline = time.time() + 300
    state: dict = {}
    while time.time() < deadline:
        state = {r["id"]: r for r in client.json("/api/runs")}.get(run, {})
        if state.get("status") == "done":
            break
        time.sleep(2)
    events = client.events(run) if run else []
    _, _, memo = client.call(f"/api/runs/{run}/memo")
    line("the review finishes with a memo and checked statements", state.get("status") == "done" and b"## Decision" in memo and any(e["type"] == "claim.checked" for e in events) and events[0].get("mock") is True,
         f"{len(events)} events, {sum(e['type'] == 'claim.checked' for e in events)} statements checked, labelled scripted: {events[0].get('mock') if events else None}")
    status, _, data = client.call("/api/research", body={"question": "Does sotorasib prolong the QT interval?", "effort": "quick"}, headers=page)
    asked = json.loads(data)
    record: dict = {}
    for _ in range(60):
        if status != 202:
            break
        _, _, data = client.call(f"/api/research/{asked['id']}", headers=page)
        record = json.loads(data)
        if record.get("status") in ("done", "failed", "cancelled"):
            break
        time.sleep(1)
    line("a research question gets a demo answer with example sources (no search, no model)", status == 202 and record.get("status") == "done" and record.get("mode") == "demo" and record.get("usd") == 0,
         f"{asked.get('id')}, mode {record.get('mode')}, {len(record.get('sources', []))} example sources, cost {record.get('usd')}")
    found = client.json("/api/search?q=KRAS", headers=page)
    line("saved research search", isinstance(found, (list, dict)) and bool(found), f"{len(found)} result(s)")
    status, _, data = client.call("/api/ask", body={"question": "Which statements were proven wrong?"}, headers=page)
    answer = json.loads(data)
    line("Ask answers by keyword, with no model", status == 200 and answer.get("mode") == "keyword", f"mode {answer.get('mode')}")
    status, _, data = client.call("/api/chat", body={"messages": [{"role": "user", "content": "What did past reviews decide about hERG?"}]}, headers=page)
    line("chat answers from saved research", status == 200 and json.loads(data).get("mode") in ("keyword", "scripted"), f"mode {json.loads(data).get('mode')}")
    for path in ("/api/glhf/status", "/api/glhf/runs", "/api/glhf/scoreboard", "/api/bixv1/runs"):
        status, _, data = client.call(path, headers=page)
        line(f"GET {path}", status == 200, f"{status}, {len(data)} bytes")
    status, _, data = client.call("/api/glhf/roles", headers=page)
    line("the swarm's roles are refused in plain words (not in the hosted app yet)", status == 501, json.loads(data).get("error", "")[:80])
    sys.exit(0 if ok else 1)


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    base, command, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
    if command == "refused":
        return refused(base)
    if command == "demo":
        return demo(base)
    if command == "features":
        return features(base)
    client = Client(base, signed_in=True)
    if command == "start":
        answer = client.json("/api/runs", body={"brief": BRIEF})
        print(answer["runId"], answer["mode"])
    elif command == "wait":
        run, want = rest[0], int(rest[1]) if len(rest) > 1 else None
        deadline = time.time() + 600
        while time.time() < deadline:
            state = {r["id"]: r for r in client.json("/api/runs")}.get(run)
            count = len(client.events(run)) if want else 0
            if state and (state["status"] == "done" or (want and count >= want)):
                print(run, state["status"], f"{count} events" if want else "")
                return
            time.sleep(2)
        sys.exit("timed out")
    elif command == "show":
        if rest:
            events = client.events(rest[0])
            keys = collections.Counter(e.get("key") for e in events if e.get("key"))
            print(len(events), "events;", dict(collections.Counter(e["type"] for e in events)), "; repeated keys:", {k: v for k, v in keys.items() if v > 1})
        else:
            for r in client.json("/api/runs"):
                print(r["id"], r["status"], r.get("error", ""))
    elif command == "digest":
        events = client.events(rest[0])
        _, _, memo = client.call(f"/api/runs/{rest[0]}/memo")
        print(len(events), "events", hashlib.sha256(json.dumps(events, sort_keys=True).encode()).hexdigest()[:16], "memo", hashlib.sha256(memo).hexdigest()[:16])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
