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
  ['foo-latest', /not a GitHub-hosted label/],
]) {
  test(`fails ${name}`, () => {
    const r = guard(fixture(name))
    assert.equal(r.status, 1, r.stderr + r.stdout)
    assert.match(r.stderr, expected)
  })
}

test('repository workflows use only GitHub-hosted runners', () => {
  const r = guard(fileURLToPath(new URL('../.github/workflows', import.meta.url)))
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /every job uses a GitHub-hosted runner/)
})
