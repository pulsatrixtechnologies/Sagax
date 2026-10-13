#!/usr/bin/env node
// Every job runs on a GitHub-hosted runner. A self-hosted label fails.
// ubuntu-latest, windows-latest, macos-latest and ubuntu-24.04-arm are the
// labels this repository uses. This check does not look at fork or repository
// guards; those belong to another change.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? '.github/workflows'
// GitHub-hosted image labels, including ubuntu-24.04-arm.
const hosted = /^(ubuntu-|windows-|macos-)|-latest$/i
const problems = []

for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const path = join(dir, file)
  const lines = readFileSync(path, 'utf8').split('\n')
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
    const hostedImage = hosted.test(value) || labels.some((l) => hosted.test(l))
    if (selfHosted)
      problems.push(`${where}: runs-on uses a self-hosted label: ${value}`)
    // matrix.os is checked against the matrix values below.
    else if (!hostedImage && !/matrix\.os/.test(value))
      problems.push(`${where}: runs-on is not a GitHub-hosted label: ${value}`)
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
    const bad = values.filter((l) => !hosted.test(l) && !l.includes('self-hosted'))
    if (bad.length) problems.push(`${path}:${i + 1}: matrix os is not a GitHub-hosted label: ${bad.join(', ')}`)
  })
}

if (problems.length) {
  console.error(`runner guard failed (${problems.length}):`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('runner guard: every job uses a GitHub-hosted runner')
