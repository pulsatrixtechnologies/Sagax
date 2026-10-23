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
- Runs on `pull_request_target` so fork pull requests are scanned. The job
  checks out only the base branch for the trusted guard script
  (`scripts/ci/term-guard.py`). It never checks out the pull request head.
  Title, branch and commits are read through the API as data. The diff
  comes from a blobless `git fetch` of the base and head commits into an
  empty bare repository and `git diff` from their merge base (no checkout,
  no diff drivers), because the API's diff media type answers HTTP 406 for
  a large pull request.

Tests: `python3 scripts/ci/term-guard.test.py`.

## Vulnerability identifiers

Added lines, the title, the branch name, and commit metadata are also
checked for a vulnerability identifier (`CVE-` plus a four-digit year and
a number). A hit prints the location only. The path allowlist for that
check is `.github/cve-id-allow-paths.txt`, read from the base branch in
CI, and is separate from the given-names list. A glob matches the full
path or the file name, so a third-party lockfile or changelog can cite an
identifier. Titles, branches, and paths are still checked.

The working tree is checked with `python3 scripts/ci/term-guard.py --tree .`.
That mode does not need the secret. It reads tracked files and untracked
files that git does not ignore, and skips the allowlisted paths.

Runs on a GitHub-hosted `ubuntu-latest` runner.

## Path allowlist

`.github/term-guard-allow-paths.txt` lists path globs (never terms) whose
added lines are not scanned, e.g. data files of common given names. It is read
from the base branch, so a change to it only takes effect after merge. Title,
branch and changed paths are still checked for allowlisted files.
