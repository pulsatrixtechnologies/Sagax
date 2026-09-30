# Sagax agent notes

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

## Where work goes

All work stays in `pulsatrixtechnologies` repositories. Never open a pull
request, issue, or push against the original OpenMausBot project
(`milind-soni/OpenMausBot`) or any other upstream. Push branches only to
`origin` (`pulsatrixtechnologies/pulsa-bot`) and target PRs at it. Pass
`--repo pulsatrixtechnologies/pulsa-bot` to `gh` so it never picks a parent
repository. Do not add an upstream remote with push access.

More specific `AGENTS.md` files override this note within their directories.
