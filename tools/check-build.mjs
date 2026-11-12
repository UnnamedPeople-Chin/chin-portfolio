// Build gate: `npm run check`.
//
// CLAUDE.md rule 6 used to be a manual ritual — build, then look at dist/ by
// hand to be sure index.html is gone. The failure it guards against is silent
// in the browser but breaks every visitor: a static index.html at "/" shadows
// the vercel.json rewrite and forces a location.replace() hop.
//
// Also asserts the film plates stay out of the build output (75 MB of source
// footage that only Remotion needs) and that the two video assets the modal
// points at actually landed.
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const DIST = resolve('dist')
const MUST = [
  'landing-pages/chin-portfolio.html',
  'chin-portfolio/moneyflow-promo.mp4',
  'chin-portfolio/moneyflow-promo-poster.webp',
]
const MUST_NOT = ['index.html', 'plates']

const build = spawnSync('npm run build', { stdio: 'inherit', shell: true })
if (build.status !== 0) {
  console.error('check: build failed')
  process.exit(build.status ?? 1)
}

const problems = []
for (const rel of MUST) {
  const p = resolve(DIST, rel)
  if (!existsSync(p) || statSync(p).size === 0) problems.push(`missing or empty: dist/${rel}`)
}
for (const rel of MUST_NOT) {
  if (existsSync(resolve(DIST, rel))) problems.push(`must not ship: dist/${rel}`)
}

if (problems.length) {
  console.error('\ncheck failed:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('check ok: dist/ has the site, no index.html, no plates/')
