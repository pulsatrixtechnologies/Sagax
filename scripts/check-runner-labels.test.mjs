import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-runner-labels.mjs', import.meta.url))
const fixture = (name) => fileURLToPath(new URL(`./testing/runner-guard-fixtures/${name}`, import.meta.url))
const guard = (dir) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })

for (const name of ['good', 'workflow-run-good', 'hosted', 'hosted-matrix']) {
  test(`passes ${name}`, () => {
    const r = guard(fixture(name))
    assert.equal(r.status, 0, r.stderr)
  })
}

for (const [name, expected] of [
  ['unknown-runner', /neither self-hosted nor a GitHub-hosted label/],
  ['no-repo-guard', /lacks the leading repository guard/],
  ['prt-no-guard', /lacks the leading repository guard/],
  ['prt-head-checkout', /must not check out pull request code/],
  ['comment-no-actor', /without the actor guard/],
  ['run-interpolation', /pass it through env: and quote it/],
  ['workflow-run-no-head-repo', /lacks the leading repository guard/],
]) {
  test(`fails ${name}`, () => {
    const r = guard(fixture(name))
    assert.equal(r.status, 1)
    assert.match(r.stderr, expected)
  })
}

test('passes the repository workflows', () => {
  const r = guard(fileURLToPath(new URL('../.github/workflows', import.meta.url)))
  assert.equal(r.status, 0, r.stderr)
})
