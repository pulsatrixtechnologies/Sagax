import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-runner-labels.mjs', import.meta.url))
const fixture = (name) => fileURLToPath(new URL(`./testing/runner-guard-fixtures/${name}`, import.meta.url))
const guard = (dir) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })

for (const name of ['hosted', 'hosted-matrix']) {
  test(`passes ${name}`, () => {
    const r = guard(fixture(name))
    assert.equal(r.status, 0, r.stderr + r.stdout)
    assert.match(r.stdout, /every job uses a GitHub-hosted runner/)
  })
}

for (const [name, expected] of [
  ['self-hosted', /uses a self-hosted label/],
  ['unknown-runner', /not a GitHub-hosted label/],
]) {
  test(`fails ${name}`, () => {
    const r = guard(fixture(name))
    assert.equal(r.status, 1)
    assert.match(r.stderr, expected)
  })
}

// codeql.yml and term-guard.yml still name self-hosted runners. Those files
// belong to other pull requests and are not edited here. Any other self-hosted
// or non-hosted label fails this test. Once those files move, a clean tree
// (exit 0) passes as well.
const PENDING = ['codeql.yml', 'term-guard.yml']

test('repository workflows have no self-hosted label outside the pending files', () => {
  const r = guard(fileURLToPath(new URL('../.github/workflows', import.meta.url)))
  const hits = r.stderr.split('\n').map((l) => l.trim()).filter((l) => l.includes('runs-on') || l.includes('matrix os'))
  if (r.status === 0) {
    assert.deepEqual(hits, [])
    return
  }
  assert.equal(r.status, 1)
  assert.ok(hits.length > 0, r.stderr)
  for (const hit of hits) assert.ok(PENDING.some((file) => hit.includes(file)), hit)
})
