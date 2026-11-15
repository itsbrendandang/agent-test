#!/usr/bin/env python3
"""Check that every one of the 100 Biomni skills is assigned to exactly one agent.

Run from anywhere: python3 glhf/specialists/verify_skills.py
Reads only files in this repo (no network, no keys). Exit code 1 on any failure.

Agent files are the *.md files in skills/ (except README, part1, part2) plus the profiles in this directory that carry
skill entries (`### N. name: full instructions|index only`): today only literature-evidence-synthesist.
"""
import collections, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SK = os.path.join(HERE, "skills")
REF = os.path.normpath(os.path.join(HERE, "..", "..", ".agents/skills/biomni-lab/references"))
ok = True


def fail(msg):
    global ok
    ok = False
    print("FAIL:", msg)


def catalog():
    out = {}
    for line in open(os.path.join(REF, "catalog.md")):
        m = re.match(r"\| (\d+) \| ([a-z0-9-]+) \| (.*?) \| (yes|no) \|", line)
        if m:
            out[int(m[1])] = dict(name=m[2], copied=m[4])
    return out


def overviews(cat):
    res = {}
    for part in ("overviews-part1.md", "overviews-part2.md"):
        lines = open(os.path.join(REF, part)).read().split("\n")
        heads, nxt = [], (1 if part.endswith("1.md") else 51)
        for i, line in enumerate(lines):
            m = re.match(r"^(\d+)\. ([a-z0-9-]+)$", line)
            if m and int(m[1]) == nxt and m[2] == cat[nxt]["name"] and i + 2 < len(lines) and lines[i + 2].startswith("Source:"):
                heads.append((nxt, i))
                nxt += 1
        for k, (n, i) in enumerate(heads):
            j = heads[k + 1][1] if k + 1 < len(heads) else len(lines)
            body = "\n".join(lines[i:j][3:]).strip()
            res[n] = dict(body=body, full=not body.startswith("No markdown preview is available"), nbody=len(body))
    return res


cat = catalog()
ov = overviews(cat)
names = {v["name"]: n for n, v in cat.items()}

skill_files = [f for f in glob.glob(SK + "/*.md") if os.path.basename(f) not in ("README.md", "part1.md", "part2.md")]
top_files = [f for f in glob.glob(HERE + "/*.md") if os.path.basename(f) != "README.md" and re.search(r"^### \d+\. ", open(f).read(), re.M)]
files = skill_files + top_files
agent_of = {f: os.path.basename(f)[:-3] for f in files}
if len(set(agent_of.values())) != len(files):
    fail("an agent name appears in both directories")
print("agent files:", len(files), f"({len(skill_files)} in skills/, {len(top_files)} merged profiles in specialists/)")

seen, fulltag = collections.defaultdict(list), {}
for f in files:
    for line in open(f):
        m = re.match(r"^### (\d+)\. ([a-z0-9-]+): (full instructions|index only)$", line.strip())
        if m:
            n = int(m[1])
            if cat[n]["name"] != m[2]:
                fail(f"{agent_of[f]}: number/name mismatch {n} {m[2]}")
            seen[n].append(agent_of[f])
            fulltag[n] = m[3]
missing = [n for n in cat if n not in seen]
dup = {n: a for n, a in seen.items() if len(a) != 1}
print("catalog skills:", len(cat), "| in agent files:", len(seen), "| missing:", missing, "| duplicates:", dup)
if len(cat) != 100 or missing or dup:
    fail("coverage in agent files")

m = json.load(open(os.path.join(SK, "skills-map.json")))
a2s, s2a = m["agent_to_skills"], m["skill_to_agent"]
flat = [s for v in a2s.values() for s in v]
c = collections.Counter(flat)
print("map: agents", len(a2s), "| skills listed", len(flat), "| unique", len(c), "| reverse index", len(s2a))
if set(flat) != set(names) or any(v != 1 for v in c.values()):
    fail("map coverage")
if set(s2a) != set(names):
    fail("reverse index coverage")
for ag, ss in a2s.items():
    for s in ss:
        if s2a[s] != ag:
            fail(f"reverse mismatch {s}")
        if seen[names[s]] != [ag]:
            fail(f"file/map disagree for {s}: {seen[names[s]]} vs {ag}")
if not (12 <= len(a2s) <= 20):
    fail("agent count outside 12-20")
if sorted(a2s) != sorted(agent_of.values()):
    fail("agent names vs files")
for gone in ("prior-work-analyst",):
    if gone in a2s or os.path.exists(os.path.join(SK, gone + ".md")) or os.path.exists(os.path.join(HERE, gone + ".md")):
        fail(f"merged-away agent {gone} still present")

nf = ni = 0
for n in cat:
    tag, o = fulltag[n], ov[n]
    if tag == "full instructions":
        nf += 1
        if not o["full"] or o["nbody"] < 200:
            fail(f"{n} marked full but source Overview missing/short ({o['nbody']} chars)")
        if cat[n]["copied"] != "yes":
            fail(f"{n} full but catalog says not copied")
    else:
        ni += 1
        if o["full"] or "No markdown preview is available" not in o["body"] or cat[n]["copied"] != "no":
            fail(f"{n} index-only mismatch")
    if m["skill_text"][cat[n]["name"]] != ("full" if tag == "full instructions" else "index_only"):
        fail(f"json text tag {n}")
print("full-text:", nf, "| index-only:", ni)

for f in files:
    t = open(f).read()
    for h in ("## Route to this agent when", "## Do not route here when", "## Skills owned", "## What this agent cannot do"):
        if h not in t:
            fail(f"{f} missing {h}")
    k = len(re.findall(r"^### \d+\.", t, re.M))
    if t.count("- package: not installed") != k or t.count("- Hub URL:") != k:
        fail(f"{f} per-skill lines")
    if "instructions only" not in t:
        fail(f"{f} lost its 'instructions only' status line")

r = open(os.path.join(SK, "README.md")).read()
tot = re.search(r"\*\*Total \((\d+) agents\)\*\* \| \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\*", r)
print("README total row:", tot.groups() if tot else None)
if not tot or tuple(map(int, tot.groups())) != (len(a2s), 100, nf, ni):
    fail("README total row")
for ag, ss in a2s.items():
    row = re.search(r"\[`%s`\].*? \| (\d+) \| (\d+) \| (\d+) \|$" % re.escape(ag), r, re.M)
    full = sum(ov[names[s]]["full"] for s in ss)
    if not row or tuple(map(int, row.groups())) != (len(ss), full, len(ss) - full):
        fail(f"README row {ag}")

# the four skills held for an owner decision are still flagged where they were
owner = {"cell-therapy-car-design": "paywall", "tusoai": "billed", "tusoskill": "compute", "sgrna-design": "commercial", "targeted-degrader-design": "non commercial"}
for skill, word in owner.items():
    if skill not in s2a:
        fail(f"owner-decision skill {skill} not in the map")
        continue
    t = open(next(f for f in files if agent_of[f] == s2a[skill])).read()
    block = re.search(r"^### \d+\. %s: .*?(?=^### |^## |\Z)" % re.escape(skill), t, re.M | re.S)
    if not block or word not in block[0].lower():
        fail(f"owner-decision flag ({word}) missing in the {skill} entry")
print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
