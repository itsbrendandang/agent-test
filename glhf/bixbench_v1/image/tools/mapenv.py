"""Map the official arm64 conda environment to linux-64, package by package, without a solver.

Input: the arm64 inventory (conda list --json, conda list --explicit) and the channels' current
repodata. For each package: noarch -> the identical file; otherwise the linux-64 build of the
same name and version whose build string matches after removing the hash (same variant, same
build number), preferring builds published before the official image was made. Then every
dependency of every chosen record is checked against the chosen set; a missing dependency is
added (x86-only packages), an unsatisfied one is reported.
Runs inside the official image (it uses conda's own MatchSpec)."""
import io, json, re, sys, datetime, collections
import zstandard
from conda.models.match_spec import MatchSpec
from conda.models.records import PackageRecord
from conda.models.version import VersionOrder

W = "/w"
SNAP = datetime.datetime(2025, 1, 19, tzinfo=datetime.timezone.utc).timestamp() * 1000
CH = {"conda-forge": "https://conda.anaconda.org/conda-forge",
      "bioconda": "https://conda.anaconda.org/bioconda",
      "pkgs/main": "https://repo.anaconda.com/pkgs/main"}
FILES = {"conda-forge": "conda-forge", "bioconda": "bioconda", "pkgs/main": "main"}

def load(channel, subdir, names=None, fns=None):
    path = f"{W}/repodata/{FILES[channel]}-{subdir}.json.zst"
    with open(path, "rb") as fh:
        data = json.load(io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(fh), encoding="utf-8"))
    out = {}
    for key in ("packages", "packages.conda"):
        for fn, rec in data.get(key, {}).items():
            if fns is not None and fn not in fns:
                continue
            out[fn] = {k: rec.get(k) for k in ("name", "version", "build", "build_number", "depends",
                                                 "constrains", "timestamp", "md5", "sha256", "size")}
    del data
    return out

inv = json.load(open(f"{W}/arm64/inventory.json"))
explicit = {u.rsplit("/", 1)[1].split("#")[0]: u for u in inv["conda_explicit"]}
def strip_ext(fn): return re.sub(r"\.(conda|tar\.bz2)$", "", fn)
arm_url = {strip_ext(fn): u for fn, u in explicit.items()}

def norm(build):
    b = re.sub(r"h[0-9a-f]{7,8}(?=_|$)", "h", build)
    return b.replace("linuxaarch64", "linux64").replace("aarch64", "x86_64")

def variant(build): return re.sub(r"_\d+$", "", norm(build))

linux = {c: load(c, "linux-64") for c in CH}
by_name = {c: collections.defaultdict(list) for c in CH}
for c, recs in linux.items():
    for fn, r in recs.items():
        by_name[c][r["name"]].append((fn, r))
noarch_fns = {u.rsplit("/", 1)[1].split("#")[0] for u in inv["conda_explicit"] if "/noarch/" in u}
ARCH_NAMED = {p["name"].replace("linux-aarch64", "linux-64") for p in inv["conda"]
              if p["platform"] == "noarch" and "linux-aarch64" in p["name"]}
def load_names(channel, subdir, names):
    path = f"{W}/repodata/{FILES[channel]}-{subdir}.json.zst"
    with open(path, "rb") as fh:
        data = json.load(io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(fh), encoding="utf-8"))
    out = {}
    for key in ("packages", "packages.conda"):
        for fn, rec in data.get(key, {}).items():
            if rec.get("name") in names:
                out[fn] = {k: rec.get(k) for k in ("name", "version", "build", "build_number", "depends",
                                                     "constrains", "timestamp", "md5", "sha256", "size")}
    return out
noarch = {c: load(c, "noarch", fns=noarch_fns) for c in CH}
for fn, r in load_names("conda-forge", "noarch", ARCH_NAMED).items():
    by_name["conda-forge"][r["name"]].append((fn, r))
    linux["conda-forge"][fn] = r
NOARCH_FN = set(fn for fn, r in linux["conda-forge"].items() if r["name"] in ARCH_NAMED)

chosen = {}   # name -> dict(fn, rec, channel, subdir, url, how, arm)
report = []
for p in inv["conda"]:
    name = p["name"].replace("linux-aarch64", "linux-64")
    arm = {"name": p["name"], "version": p["version"], "build": p["build"], "channel": p["channel"]}
    key = f"{p['name']}-{p['version']}-{p['build']}"
    if p["platform"] == "noarch" and name == p["name"]:
        url = arm_url[key].split("#")[0]
        fn = url.rsplit("/", 1)[1]
        rec = noarch[p["channel"]].get(fn)
        if rec is None:
            report.append({"name": name, "arm64": arm, "amd64": None, "match": "noarch file no longer in channel index"})
            rec = {"name": name, "version": p["version"], "build": p["build"], "build_number": 0, "depends": [], "constrains": [], "md5": None}
        chosen[name] = {"fn": fn, "rec": rec, "channel": p["channel"], "subdir": "noarch", "url": url, "how": "identical file (noarch)", "arm": arm}
        continue
    order = [p["channel"]] + [c for c in CH if c != p["channel"]]
    cands = []
    for c in order:
        cands = [(fn, r, c) for fn, r in by_name[c].get(name, []) if r["version"] == p["version"]]
        if cands:
            break
    how_extra = ""
    if not cands:
        # no linux-64 build at this version: nearest version in the same channel
        allv = [(fn, r, c) for c in order for fn, r in by_name[c].get(name, [])]
        if not allv:
            report.append({"name": name, "arm64": arm, "amd64": None, "match": "NO linux-64 package of this name"})
            continue
        target = VersionOrder(p["version"])
        older = [x for x in allv if VersionOrder(x[1]["version"]) <= target]
        pool = older or allv
        best_v = max((VersionOrder(x[1]["version"]) for x in pool)) if older else min((VersionOrder(x[1]["version"]) for x in pool))
        cands = [x for x in pool if VersionOrder(x[1]["version"]) == best_v]
        how_extra = "VERSION DIFFERS"
    ext = ".conda" if arm_url[key].split("#")[0].endswith(".conda") else ".tar.bz2"
    m = re.search(r"_(\d+)$", p["build"])
    def score(x, p=p, m=m, ext=ext):
        fn, r, c = x
        s = 0
        if r["build"] == p["build"]: s += 1000
        if variant(r["build"]) == variant(p["build"]): s += 100
        if m and r["build_number"] == int(m.group(1)): s += 50
        if (r.get("timestamp") or 0) <= SNAP: s += 10
        if fn.endswith(ext): s += 1
        return (s, r.get("timestamp") or 0)
    cands.sort(key=score, reverse=True)
    chosen[name] = {"cands": cands, "pick": 0, "channel": cands[0][2], "subdir": "linux-64", "arm": arm, "how_extra": how_extra, "score": score}

def rec_of(name):
    c = chosen[name]
    if "rec" in c: return c["fn"], c["rec"], c["channel"], c["subdir"]
    fn, r, ch = c["cands"][c["pick"]]
    return fn, r, ch, ("noarch" if fn in NOARCH_FN else "linux-64")

def as_record(name):
    fn, r, ch, sub = rec_of(name)
    return PackageRecord(name=r["name"], version=r["version"], build=r["build"], build_number=r["build_number"] or 0,
                         channel=CH[ch], subdir=sub, fn=fn)

def problems_of(name, pick=None):
    c = chosen[name]
    if pick is not None and "cands" in c:
        r = c["cands"][pick][1]
    else:
        r = rec_of(name)[1]
    out = []
    for dep in r.get("depends") or []:
        ms = MatchSpec(dep)
        if ms.name.startswith("__"): continue
        if ms.name not in chosen:
            out.append(("missing", dep)); continue
        if not ms.match(as_record(ms.name)):
            out.append(("unsatisfied", dep))
    for dep in r.get("constrains") or []:
        ms = MatchSpec(dep)
        if ms.name.startswith("__") or ms.name not in chosen: continue
        if not ms.match(as_record(ms.name)):
            out.append(("constraint", dep))
    return out

# Overrides, each with its reason.
OVERRIDES = {
    # sysroot_linux-64 2.17 (same version and build number as the arm64 sysroot) is built for the
    # 3.10 kernel headers; arm64's 4.18.0 headers do not go with a linux-64 sysroot of 2.17.
    "kernel-headers_linux-64": ("3.10.0", "he073ed8_18", "VERSION DIFFERS: the linux-64 sysroot 2.17 needs kernel headers 3.10.0 (arm64 has 4.18.0)"),
    # libmamba's linux-64 build needs reproc >= 14.2.5; the arm64 build accepts the 14.2.4 that
    # the official image has from pkgs/main. Without this mamba would not start.
    "reproc": ("14.2.5.post0", "hb9d3cd8_0", "VERSION DIFFERS: linux-64 libmamba 2.0.5 needs reproc >= 14.2.5 (arm64 has 14.2.4 from pkgs/main); CHANNEL DIFFERS (pkgs/main -> conda-forge)"),
    "reproc-cpp": ("14.2.5.post0", "h5888daf_0", "VERSION DIFFERS: linux-64 libmamba 2.0.5 needs reproc-cpp >= 14.2.5 (arm64 has 14.2.4 from pkgs/main); CHANNEL DIFFERS (pkgs/main -> conda-forge)"),
}
for oname, (over_v, over_b, why) in OVERRIDES.items():
    found = [(fn, r, "conda-forge") for fn, r in by_name["conda-forge"].get(oname, []) if r["version"] == over_v and r["build"] == over_b]
    if not found:
        print("OVERRIDE NOT FOUND", oname, sorted((r["version"], r["build"]) for fn, r in by_name["conda-forge"].get(oname, []) if r["version"].startswith(over_v[:6])))
        continue
    chosen[oname].update(cands=found[:1], pick=0, channel="conda-forge", how_extra=why)

# Pass 1: among candidates of equal variant, prefer one whose own dependencies fit the set.
for _ in range(4):
    changed = 0
    for name, c in chosen.items():
        if "cands" not in c: continue
        cur = [x for x in problems_of(name) if x[0] != "missing"]
        if not cur: continue
        top = c["score"](c["cands"][0])[0]
        for i, cand in enumerate(c["cands"]):
            if c["score"](cand)[0] < top - 11:  # only builds that differ in the hash alone
                break
            if not [x for x in problems_of(name, i) if x[0] != "missing"]:
                if i != c["pick"]:
                    c["pick"] = i; changed += 1
                break
    if not changed: break

# Pass 2: add dependencies that the arm64 environment does not have (x86-only packages).
added = []
for _ in range(6):
    missing = {}
    for name in list(chosen):
        for kind, dep in problems_of(name):
            if kind == "missing":
                missing.setdefault(MatchSpec(dep).name, []).append((name, dep))
    if not missing: break
    for dname, wants in missing.items():
        pool = []
        for ch in ("conda-forge", "bioconda", "pkgs/main"):
            pool = [(fn, r, ch) for fn, r in by_name[ch].get(dname, [])]
            if pool: break
        ok = [x for x in pool if all(MatchSpec(dep).match(PackageRecord(name=x[1]["name"], version=x[1]["version"], build=x[1]["build"], build_number=x[1]["build_number"] or 0, channel=CH[x[2]], subdir="linux-64", fn=x[0])) for _, dep in wants)]
        if not ok:
            report.append({"name": dname, "arm64": None, "amd64": None, "match": f"MISSING DEPENDENCY not found for {wants[:3]}"})
            chosen[dname] = {"fn": "none", "rec": {"name": dname, "version": "0", "build": "none", "build_number": 0, "depends": [], "constrains": []}, "channel": "conda-forge", "subdir": "linux-64", "url": None, "how": "unresolved", "arm": None}
            continue
        before = [x for x in ok if (x[1].get("timestamp") or 0) <= SNAP] or ok
        best = max(before, key=lambda x: (VersionOrder(x[1]["version"]), x[1]["build_number"] or 0, x[1].get("timestamp") or 0))
        chosen[dname] = {"cands": [best], "pick": 0, "channel": best[2], "subdir": "linux-64", "arm": None, "how_extra": "ADDED (dependency of a linux-64 build; not in the arm64 image): wanted by " + ", ".join(sorted({w for w, _ in wants})[:5]), "score": lambda x: (0, 0)}
        added.append(dname)

# The same check on the official arm64 environment itself, to tell inherited problems from new ones.
arm_fns = {u.rsplit("/", 1)[1].split("#")[0] for u in inv["conda_explicit"]}
arm_recs = {}
for c in CH:
    for sub in ("linux-aarch64", "noarch"):
        for fn, r in load(c, sub, fns=arm_fns).items():
            arm_recs[r["name"]] = (fn, r, c, sub)
def arm_record(n):
    fn, r, c, sub = arm_recs[n]
    return PackageRecord(name=r["name"], version=r["version"], build=r["build"], build_number=r["build_number"] or 0, channel=CH[c], subdir=sub, fn=fn)
arm_problems = set()
for n, (fn, r, c, sub) in arm_recs.items():
    for kind, deps in (("unsatisfied", r.get("depends") or []), ("constraint", r.get("constrains") or [])):
        for dep in deps:
            ms = MatchSpec(dep)
            if ms.name.startswith("__"): continue
            if ms.name not in arm_recs:
                if kind == "unsatisfied": arm_problems.add((n.replace("linux-aarch64", "linux-64"), ms.name.replace("linux-aarch64", "linux-64")))
            elif not ms.match(arm_record(ms.name)):
                arm_problems.add((n.replace("linux-aarch64", "linux-64"), ms.name.replace("linux-aarch64", "linux-64")))
print("arm64 packages found in today's index:", len(arm_recs), "of", len(inv["conda"]), "; arm64 dependency problems:", len(arm_problems))

# Result
final, mapping, unsat = {}, [], []
for name, c in chosen.items():
    fn, r, ch, sub = rec_of(name)
    if c.get("url") is None and "cands" not in c:
        continue
    url = c.get("url") or f"{CH[ch]}/{sub}/{fn}"
    arm = c.get("arm")
    if "cands" in c:
        if arm is None: how = c["how_extra"]
        elif c["how_extra"]: how = c["how_extra"]; ch = None
        elif r["build"] == arm["build"]: how = "same version, same build string"
        elif norm(r["build"]) == norm(arm["build"]) and str(r["build_number"]) == (re.search(r"_(\d+)$", arm["build"]) or [None, None])[1]: how = "same version, same variant and build number"
        elif variant(r["build"]) == variant(arm["build"]): how = f"same version, same variant, BUILD NUMBER DIFFERS ({arm['build']} -> {r['build']})"
        else: how = "same version, DIFFERENT BUILD VARIANT"
        if ch is None: ch = rec_of(name)[2]
        elif arm is not None and ch != arm["channel"]: how += f"; CHANNEL DIFFERS ({arm['channel']} -> {ch})"
    else:
        how = c["how"]
    probs = problems_of(name)
    for kind, dep in probs:
        unsat.append({"package": f"{name}-{r['version']}-{r['build']}", "kind": kind, "spec": dep,
                      "also_in_official_arm64_image": (name, MatchSpec(dep).name) in arm_problems,
                      "have": (lambda n: (lambda x: f"{x[1]['version']}-{x[1]['build']}")(rec_of(n)) if n in chosen else None)(MatchSpec(dep).name)})
    final[name] = {"url": url, "md5": r.get("md5"), "depends": [MatchSpec(d).name for d in (r.get("depends") or [])]}
    mapping.append({"name": name, "arm64": arm and {"version": arm["version"], "build": arm["build"], "channel": arm["channel"]},
                    "amd64": {"version": r["version"], "build": r["build"], "channel": ch, "subdir": sub, "file": fn}, "match": how})

# Topological order (dependencies first), stable by name.
order, seen = [], set()
def visit(n, stack=()):
    if n in seen or n not in final: return
    seen.add(n)
    for d in sorted(final[n]["depends"]):
        if d not in stack: visit(d, stack + (n,))
    order.append(n)
sys.setrecursionlimit(10000)
for n in sorted(final): visit(n)
with open(f"{W}/out/explicit-linux-64.txt", "w") as fh:
    fh.write("# Explicit linux-64 package list for the BixBench v1 sandbox image on Modal.\n"
             "# Made by image/tools/mapenv.py from the official arm64 image's `conda list --explicit`.\n@EXPLICIT\n")
    for n in order:
        fh.write(final[n]["url"] + (f"#{final[n]['md5']}" if final[n]["md5"] else "") + "\n")
json.dump({"mapping": sorted(mapping, key=lambda m: m["name"]), "not_mapped": report, "added": sorted(added),
           "dependency_problems": unsat}, open(f"{W}/out/mapping.json", "w"), indent=1)
cnt = collections.Counter(m["match"].split(";")[0].split(":")[0] for m in mapping)
for k, v in cnt.most_common(): print(v, k)
print("not mapped:", json.dumps(report, indent=1)[:3000])
print("added:", sorted(added))
print("dependency problems:", len(unsat))
for u in unsat[:80]: print("  ", u)
