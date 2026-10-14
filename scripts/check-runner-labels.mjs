#!/usr/bin/env node
// Every job runs on a GitHub-hosted runner. A self-hosted label fails, and so
// does any label outside the allowlist below (an invented name such as
// foo-latest included). This check does not look at fork or repository
// guards; those belong to another change.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? '.github/workflows'
// GitHub-hosted images this repository may name. Anything else fails.
const HOSTED = new Set([
  'ubuntu-latest',
  'ubuntu-24.04',
  'ubuntu-22.04',
  'ubuntu-24.04-arm',
  'ubuntu-22.04-arm',
  'windows-latest',
  'windows-2025',
  'windows-2022',
  'macos-latest',
  'macos-15',
  'macos-14',
])
const isHosted = (label) => HOSTED.has(label)
const problems = []

for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const path = join(dir, file)
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)runs-on:\s*(.*)$/)
    if (!m || line.trim().startsWith('#')) return
    let value = m[2].replace(/\s+#.*$/, '').trim()
    // Block form: collect the following "- label" lines.
    if (value === '' || value === '|' || value === '>') {
      const items = []
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(/^\s*-\s*(.+)$/)
        if (!item) break
        items.push(item[1].trim())
      }
      value = `[${items.join(', ')}]`
    }
    const where = `${path}:${i + 1}`
    const labels = []
    if (value.includes('${{')) {
      for (const q of value.matchAll(/['"]([^'"]+)['"]/g)) labels.push(q[1])
    } else {
      labels.push(...value.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean))
    }
    const selfHosted = value.includes('self-hosted') || labels.includes('self-hosted')
    if (selfHosted)
      problems.push(`${where}: runs-on uses a self-hosted label: ${value}`)
    // matrix.os is checked against the matrix values below.
    else if (!/matrix\.os/.test(value)) {
      const bad = labels.filter((l) => !isHosted(l))
      if (bad.length || labels.length === 0)
        problems.push(`${where}: runs-on is not a GitHub-hosted label: ${value}`)
    }
  })
  lines.forEach((line, i) => {
    const m = line.match(/^\s*os:\s*\[(.*)\]/)
    if (!m) return
    const routed = lines.some((l) => /runs-on:.*matrix\.os/.test(l))
    if (!routed) return
    const values = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    const selfHostedValues = values.filter((l) => l.includes('self-hosted'))
    if (selfHostedValues.length)
      problems.push(`${path}:${i + 1}: matrix os uses a self-hosted label: ${selfHostedValues.join(', ')}`)
    const bad = values.filter((l) => !isHosted(l) && !l.includes('self-hosted'))
    if (bad.length) problems.push(`${path}:${i + 1}: matrix os is not a GitHub-hosted label: ${bad.join(', ')}`)
  })
}

if (problems.length) {
  console.error(`runner guard failed (${problems.length}):`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('runner guard: every job uses a GitHub-hosted runner')
