# Image scan exceptions

The image workflow fails when the scan reports a high or critical finding.
The exception list is not stored in this repository.

It is the Actions secret `TRIVYIGNORE_PRIVATE`. One identifier per line.
The comment above each line must give a reason the checker accepts and
exactly one `Review YYYY-MM-DD`. The accepted reason phrases are in
`scripts/trivy-ignore-guard.mjs`. Do not copy an inventory into the
repository, a pull request, or a commit message.

A missing or blank secret fails the job. A secret that is only comments
means the scan ignores nothing. The workflow writes a temporary file and
uses that same file for the smoke job, the publish job, and the signing
proof. A second scan, taken without the list, checks that each exception
is still reported, still unfixed, and that its review date has not passed.
An empty list is allowed for that second check. The temporary file is not
uploaded, and the job output does not print the lines.

Do not commit an identifier, an ignore file, or a findings count.
