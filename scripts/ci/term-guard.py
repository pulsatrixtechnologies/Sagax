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

A vulnerability identifier (CVE- followed by a year and a number) is also
refused in the title, branch, commit metadata, added lines, and, with
--tree ROOT, in tracked and untracked text files. That check uses
CVE_ALLOW_FILE (default .github/cve-id-allow-paths.txt), a separate path
list: a glob matches the full path or the file name, so a third-party
lockfile or changelog can cite an identifier. A hit prints the location
only. --tree does not require FORBIDDEN_TERMS. Titles, branches, and
paths are still checked.

Usage: term-guard.py [--commits COMMITS_JSON] [--tree ROOT] [DIFF_FILE]
       (PR_TITLE and PR_BRANCH come from the environment)
"""
import json
import fnmatch
import os
import re
import subprocess
import sys

DEFAULT_ALLOW_FILE = ".github/term-guard-allow-paths.txt"
DEFAULT_CVE_ALLOW_FILE = ".github/cve-id-allow-paths.txt"
CVE_ID = re.compile(r"CVE-\d{4}-\d+")


def load_allow(path=None):
    path = path or os.environ.get("ALLOW_FILE") or DEFAULT_ALLOW_FILE
    try:
        with open(path, encoding="utf-8") as fh:
            return [l.strip() for l in fh if l.strip() and not l.strip().startswith("#")]
    except FileNotFoundError:
        return []


def allowed(path, globs):
    return bool(path) and any(fnmatch.fnmatchcase(path, g) for g in globs)


def cve_allowed(path, globs):
    """Full path or file name. Basename matching stays off the shared allowlist."""
    if not path:
        return False
    base = os.path.basename(path)
    return any(fnmatch.fnmatchcase(path, g) or fnmatch.fnmatchcase(base, g) for g in globs)


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


def scan_diff(lines, terms, allow=(), allow_fn=allowed):
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
            skip = allow_fn(path, allow)
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


def load_cve_allow():
    return load_allow(os.environ.get("CVE_ALLOW_FILE") or DEFAULT_CVE_ALLOW_FILE)


def scan_cve_surface(title, branch, commits, diff_lines):
    terms = [CVE_ID]
    allow = load_cve_allow()
    found = []
    if hit(title, terms):
        found.append("title")
    if hit(branch, terms):
        found.append("branch")
    if commits is not None:
        found += scan_commits(commits, terms)
    if diff_lines is not None:
        found += scan_diff(diff_lines, terms, allow, cve_allowed)
    return found


def scan_tree(root):
    """Tracked and untracked text, honoring gitignore. Fail closed if git fails."""
    try:
        proc = subprocess.run(
            ["git", "-C", root, "ls-files", "-z", "-c", "-o", "--exclude-standard"],
            capture_output=True,
        )
    except OSError:
        return ["tree (git failed)"]
    if proc.returncode != 0:
        return ["tree (git ls-files failed)"]
    allow = load_cve_allow()
    found = []
    for raw in proc.stdout.split(b"\0"):
        if not raw:
            continue
        rel = raw.decode("utf-8", "surrogateescape")
        if cve_allowed(rel, allow):
            continue
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        if b"\0" in data:
            continue
        text = data.decode("utf-8", "replace")
        for n, line in enumerate(text.splitlines(), 1):
            if CVE_ID.search(line):
                where = f"file:{n}" if CVE_ID.search(rel) else f"{rel}:{n}"
                found.append(where)
    return found


def main(argv):
    args = list(argv[1:])
    tree_root = None
    if "--tree" in args:
        i = args.index("--tree")
        if i + 1 >= len(args):
            print("::error::--tree needs a path")
            return 2
        tree_root = args[i + 1]
        del args[i:i + 2]
    commits = None
    if "--commits" in args:
        i = args.index("--commits")
        with open(args[i + 1], encoding="utf-8") as fh:
            text = fh.read().strip()
        # a JSON array, or one commit object per line (gh api --paginate --jq '.[]')
        commits = json.loads(text) if text.startswith("[") else [json.loads(l) for l in text.splitlines() if l.strip()]
        del args[i:i + 2]
    diff_lines = None
    if args:
        with open(args[0], encoding="utf-8", errors="replace") as fh:
            diff_lines = fh.readlines()

    title = os.environ.get("PR_TITLE", "")
    branch = os.environ.get("PR_BRANCH", "")
    cve_found = scan_cve_surface(title, branch, commits, diff_lines)
    if tree_root is not None:
        cve_found += scan_tree(tree_root)

    wants_terms = commits is not None or diff_lines is not None or bool(title) or bool(branch)
    terms = load_terms()
    found = []
    if wants_terms:
        if not terms:
            if cve_found:
                for where in cve_found:
                    print(f"::error::Vulnerability identifier found in {where}")
                print(f"{len(cve_found)} location(s) contain a vulnerability identifier. The identifier is not shown.")
                return 1
            print("::error::FORBIDDEN_TERMS is empty or unavailable; failing closed.")
            return 2
        if hit(title, terms):
            found.append("title")
        if hit(branch, terms):
            found.append("branch")
        if commits is not None:
            found += scan_commits(commits, terms)
        if diff_lines is not None:
            found += scan_diff(diff_lines, terms, load_allow())

    if cve_found or found:
        for where in cve_found:
            print(f"::error::Vulnerability identifier found in {where}")
        for where in found:
            print(f"::error::Forbidden term found in {where}")
        if found:
            print(f"{len(found)} location(s) contain a forbidden term. The term is not shown; check the locations above.")
        if cve_found:
            print(f"{len(cve_found)} location(s) contain a vulnerability identifier. The identifier is not shown.")
        return 1
    if tree_root is not None and not wants_terms:
        print("No vulnerability identifiers in the tree.")
        return 0
    print(f"No forbidden terms in title, branch, commits, or diff ({len(terms)} terms checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
