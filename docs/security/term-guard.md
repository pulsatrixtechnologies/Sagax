# PR term guard

`.github/workflows/term-guard.yml` fails a pull request whose title, branch
name, changed paths or added lines contain a forbidden term. The list is not
in this repository; it is the `FORBIDDEN_TERMS` Actions secret
(newline-separated, `#` lines ignored, case-insensitive substring match; a
line starting with `re:` is a case-insensitive regular expression, e.g. for an
e-mail address or a whole domain).

It also scans every commit in the pull request: author and committer name and
e-mail, and the commit message (`commit <sha> author email`, ...). Use a
GitHub noreply address (`<id>+<login>@users.noreply.github.com`) for commits.

- A hit prints only the location (`title`, `branch`, `path:line` or `file #N`),
  never the term; every term is also registered with `::add-mask::`.
- Missing or empty secret: the job fails (fail closed).
- Runs on `pull_request_target` so fork PRs are covered; it checks out only the
  base branch's `scripts/ci/term-guard.py` and reads the PR as data through the
  API. It never checks out or executes pull-request code.

Tests: `python3 scripts/ci/term-guard.test.py`.

Runs on self-hosted Linux runners only.

## Path allowlist

`.github/term-guard-allow-paths.txt` lists path globs (never terms) whose
added lines are not scanned, e.g. data files of common given names. It is read
from the base branch, so a change to it only takes effect after merge. Title,
branch and changed paths are still checked for allowlisted files.
