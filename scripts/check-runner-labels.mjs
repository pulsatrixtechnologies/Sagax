#!/usr/bin/env node
// Fails when any job in .github/workflows would run on a GitHub-hosted runner.
// Every runs-on must name self-hosted and no GitHub-hosted image label.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? '.github/workflows'
const hosted = /^(ubuntu-|windows-|macos-)|-latest$/i
// Sagax is public: a fork pull request must never reach a self-hosted runner.
const FORK_GUARD = "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)"
const problems = []

// Job-level fork guard and pull_request_target safety, per workflow file.
function checkForkSafety(path, lines) {
  const jobsAt = lines.indexOf('jobs:')
  if (jobsAt < 0) return
  const starts = []
  for (let i = jobsAt + 1; i < lines.length; i++) if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) starts.push(i)
  starts.push(lines.length)
  for (let n = 0; n + 1 < starts.length; n++) {
    const block = lines.slice(starts[n], starts[n + 1])
    const name = block[0].trim().replace(/:$/, '')
    if (!block.some((l) => /^    runs-on:/.test(l))) continue // reusable-workflow call
    const at = block.findIndex((l) => /^    if:/.test(l))
    let cond = ''
    if (at >= 0) {
      cond = block[at].replace(/^    if:/, '')
      for (let k = at + 1; k < block.length && /^      /.test(block[k]); k++) cond += ' ' + block[k]
    }
    const flat = cond.replace(/\s+/g, ' ').replace(/^ ?(>-|>|\|)? ?(\$\{\{ ?)?/, '')
    if (!flat.startsWith(FORK_GUARD + ' &&') && flat.trim() !== FORK_GUARD)
      problems.push(`${path}:${starts[n] + 1}: job ${name} lacks the leading fork guard: if: ${FORK_GUARD} && (...)`)
  }
  // pull_request_target and workflow_run carry secrets and write tokens: they must
  // never check out or run the pull request's code.
  const text = lines.join('\n')
  if (/\b(pull_request_target|workflow_run)\b/.test(text)) {
    lines.forEach((l, i) => {
      if (/^\s*ref:.*(pull_request\.head|head_sha|head_ref|head\.sha|head\.ref|refs\/pull\/)/.test(l))
        problems.push(`${path}:${i + 1}: pull_request_target/workflow_run must not check out pull request code: ${l.trim()}`)
    })
  }
}

for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const path = join(dir, file)
  const lines = readFileSync(path, 'utf8').split('\n')
  checkForkSafety(path, lines)
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
      // Expressions: every quoted literal inside must be a self-hosted label set.
      for (const q of value.matchAll(/['"]([^'"]+)['"]/g)) labels.push(q[1])
      if (/matrix\./.test(value) && !value.includes('self-hosted')) {
        problems.push(`${where}: runs-on resolves through a matrix/expression without self-hosted: ${value}`)
        return
      }
    } else {
      labels.push(...value.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean))
    }
    const bad = labels.filter((l) => hosted.test(l))
    if (bad.length) problems.push(`${where}: GitHub-hosted label(s) ${bad.join(', ')}`)
    else if (!value.includes('self-hosted')) problems.push(`${where}: runs-on lacks self-hosted: ${value}`)
  })
  // Matrix values that look like hosted images are a problem when a job routes runs-on through them.
  lines.forEach((line, i) => {
    const m = line.match(/^\s*os:\s*\[(.*)\]/)
    if (!m) return
    const bad = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter((l) => hosted.test(l))
    const routed = lines.some((l) => /runs-on:.*matrix\.os/.test(l) && !l.includes('self-hosted'))
    if (bad.length && routed) problems.push(`${path}:${i + 1}: matrix os feeds runs-on with hosted label(s) ${bad.join(', ')}`)
  })
}

if (problems.length) {
  console.error(`GitHub-hosted runners are not allowed (${problems.length}):`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('runner guard: every job runs on a self-hosted runner behind the fork guard')
