# Merge order for the MCP permissions branch

Checked on 2026-10-14 against open pull requests 492 to 514, by file overlap
with this branch (`git diff --name-only origin/main...HEAD`) and a local
`git merge-tree` of each head against this branch. This branch is #508.

## Overlap and real conflicts

| PR | State | Shared files with this branch | Merge with this branch |
|---|---|---|---|
| 495 native flow compute tools | draft | `server/index.ts` | clean |
| 496 recognize memory v2 tools | open | `server/perspicax-mcp.test.ts` | clean |
| 497 native claim tools | open | `server/drivers/agents-call.ts`, `server/drivers/agents-catalog.ts`, `server/index.ts`, `server/member-tool-scope.ts`, `server/perspicax-mcp.ts` | **conflicts** in `server/drivers/agents-catalog.ts` and `server/index.ts` (the other shared files merge on their own) |
| 492, 493, 494, 498 to 507, 509 to 514 | open | none | clean |

495 and 496 each merge cleanly with 497. Of the unrelated pull requests none
touches a file of this branch.

## Recommended order

1. The unrelated pull requests (492 to 494, 498 to 507, 509 to 514), in any
   order. They do not interact with this work.
2. 496, then 495 once it leaves draft. Both merge cleanly in either order.
3. 497 (native claim tools). It is the only open pull request with real
   conflicts against this branch, in the catalog and in `server/index.ts`,
   and it is ready, while this branch is a draft.
4. This branch (#508), last. Rebase it on main after 497: re-add the
   permission rows for the claim tools if 497 renamed any, regenerate the
   catalog goldens with `UPDATE_AGENTS_CATALOG_GOLDENS=1`, re-set
   `BUDGET_BASELINE` by hand from the printed sizes, then run
   `server/mcp-permissions.test.ts` (it fails while a catalog tool has no
   permission) and `server/drivers/agents-catalog-wire.test.ts`.

The permission registry test is the safety net for steps 2 and 3: a tool they
add without a row in `MCP_PERMISSIONS` fails it, so the rebase cannot miss one.
