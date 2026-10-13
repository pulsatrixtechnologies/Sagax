#!/usr/bin/env python3
"""Fail when a PR title, branch name, changed path, or added diff line contains
a forbidden term. Terms come from the FORBIDDEN_TERMS environment variable
(newline-separated, read from an Actions secret) and are matched
case-insensitively. A hit prints only where it was found (title, branch,
file:line), never the term itself. No terms configured means failure (fail closed).

Path allowlist: added lines in files matching a glob in ALLOW_FILE (default
.github/term-guard-allow-paths.txt, one glob per line, '#' comments) are not
scanned. The allowlist holds paths only, never terms. In CI it is read from the
BASE branch, so a pull request cannot allowlist its own files. Title, branch
and changed paths are always checked.

Terms: a line is a case-insensitive substring, or a regular expression when it
starts with "re:" (e.g. an e-mail address pattern or a whole domain).

Commit metadata: with --commits FILE (GET /pulls/N/commits as a JSON array or
one object per line) every
commit's author and committer name and e-mail and its message are scanned too.

Usage: term-guard.py [--commits COMMITS_JSON] DIFF_FILE
       (PR_TITLE and PR_BRANCH come from the environment)
"""
import json
import fnmatch
import os
import re
import sys

DEFAULT_ALLOW_FILE = ".github/term-guard-allow-paths.txt"


def load_allow(path=None):
    path = path or os.environ.get("ALLOW_FILE") or DEFAULT_ALLOW_FILE
    try:
        with open(path, encoding="utf-8") as fh:
            return [l.strip() for l in fh if l.strip() and not l.strip().startswith("#")]
    except FileNotFoundError:
        return []


def allowed(path, globs):
    return bool(path) and any(fnmatch.fnmatchcase(path, g) for g in globs)


def load_terms():
    raw = os.environ.get("FORBIDDEN_TERMS", "")
    terms = []
    for line in raw.splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        if t.lower().startswith("re:"):
            terms.append(re.compile(t[3:].strip(), re.IGNORECASE))
        else:
            terms.append(t.lower())
    plain = sorted({t for t in terms if isinstance(t, str)}, key=len, reverse=True)
    return plain + [t for t in terms if not isinstance(t, str)]


def hit(text, terms):
    low = text.lower()
    return any((t in low) if isinstance(t, str) else t.search(text) for t in terms)


def scan_commits(commits, terms):
    """Author/committer name and e-mail, and the message, of every PR commit."""
    found = []
    for c in commits:
        sha = (c.get("sha") or "?")[:9]
        meta = c.get("commit") or {}
        for role in ("author", "committer"):
            who = meta.get(role) or {}
            for field in ("name", "email"):
                if hit(who.get(field) or "", terms):
                    found.append(f"commit {sha} {role} {field}")
        if hit(meta.get("message") or "", terms):
            found.append(f"commit {sha} message")
    return found


def scan_diff(lines, terms, allow=()):
    found = []
    path, new_line, index, skip = None, 0, 0, False
    for raw in lines:
        line = raw.rstrip("\n")
        if line.startswith("diff --git "):
            index += 1
            path, new_line = None, 0
            if hit(line, terms):
                found.append(f"file #{index} path")
            continue
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else line[4:]
            skip = allowed(path, allow)
            if hit(path, terms):
                path = f"file #{index}"
            continue
        if line.startswith("--- "):
            continue
        if line.startswith("rename ") or line.startswith("copy "):
            if hit(line, terms):
                found.append(f"file #{index} rename/copy path")
            continue
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if m:
            new_line = int(m.group(1))
            continue
        if line.startswith("+"):
            if not skip and hit(line[1:], terms):
                found.append(f"{path or '?'}:{new_line}")
            new_line += 1
        elif line.startswith(" "):
            new_line += 1
    return found


def main(argv):
    terms = load_terms()
    if not terms:
        print("::error::FORBIDDEN_TERMS is empty or unavailable; failing closed.")
        return 2
    found = []
    if hit(os.environ.get("PR_TITLE", ""), terms):
        found.append("title")
    if hit(os.environ.get("PR_BRANCH", ""), terms):
        found.append("branch")
    args = list(argv[1:])
    if "--commits" in args:
        i = args.index("--commits")
        with open(args[i + 1], encoding="utf-8") as fh:
            text = fh.read().strip()
        # a JSON array, or one commit object per line (gh api --paginate --jq '.[]')
        commits = json.loads(text) if text.startswith("[") else [json.loads(l) for l in text.splitlines() if l.strip()]
        found += scan_commits(commits, terms)
        del args[i:i + 2]
    if args:
        with open(args[0], encoding="utf-8", errors="replace") as fh:
            found += scan_diff(fh, terms, load_allow())
    if found:
        for where in found:
            print(f"::error::Forbidden term found in {where}")
        print(f"{len(found)} location(s) contain a forbidden term. The term is not shown; check the locations above.")
        return 1
    print(f"No forbidden terms in title, branch, commits, or diff ({len(terms)} terms checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
