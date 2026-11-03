// Publishes the current main branch to students.
//
//   npm run release              checks, tags v<version>, pushes main + tag to origin and hpca
//   npm run release -- --dry-run checks only, pushes nothing
//
// Workflow:
//   - Day-to-day work: commit on main and `git push origin main`
//     -> JCMoure/rvcat-web-ui deploys the testing site.
//   - Release: bump RVCAT_VERSION (src/common.js) and package.json "version", commit,
//     then `npm run release` -> HPCA4SE-UAB/rvcat-web-ui deploys the students' site.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REMOTES = ['origin', 'hpca']   // pushed in this order
const BRANCH  = 'main'
const dryRun  = process.argv.includes('--dry-run')
const root    = resolve(import.meta.dirname, '..')
const npx     = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1) }
const isAncestor = (a, b) => {
  try { git('merge-base', '--is-ancestor', a, b); return true } catch { return false }
}

// 1. Repository state
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== BRANCH) fail(`Releases are made from '${BRANCH}'.`)
if (git('status', '--porcelain') !== '') fail('Working tree has uncommitted changes.')

console.log('🔄 Fetching remotes ...')
for (const remote of REMOTES) git('fetch', '--quiet', '--tags', remote)

for (const remote of REMOTES) {
  const ref = `${remote}/${BRANCH}`
  if (!isAncestor(ref, 'HEAD')) {
    fail(`${ref} has commits that are not in local ${BRANCH}. Merge them first (git merge ${ref}).`)
  }
}

// 2. Checks
run('node', [join('scripts', 'check-version.mjs')])
run(npx, ['eslint', '.'])
run(npx, ['vitest', 'run'])
run(npx, ['vite', 'build'])

// 3. Tag
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const tag     = `v${version}`
const head    = git('rev-parse', 'HEAD')
const tagCommit = git('tag', '--list', tag) ? git('rev-parse', `${tag}^{commit}`) : null

if (tagCommit && tagCommit !== head) {
  fail(`Tag ${tag} already exists on another commit. Bump the version in package.json and src/common.js.`)
}

if (dryRun) {
  console.log(`✅ Dry run OK: would tag ${tag} and push ${BRANCH} to ${REMOTES.join(', ')}.`)
  process.exit(0)
}

if (!tagCommit) {
  git('tag', '-a', tag, '-m', `RVCAT-WEB ${version}`)
  console.log(`🏷️  Created tag ${tag}`)
}

// 4. Push
for (const remote of REMOTES) {
  console.log(`🚀 Pushing ${BRANCH} and ${tag} to ${remote} ...`)
  run('git', ['push', remote, BRANCH, tag])
}
console.log(`✅ Released ${tag}. GitHub Actions will deploy both sites.`)
