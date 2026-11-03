// Builds the RVCAT Python wheel and copies it to public/.
//
//   npm run update-wheel                 (RVCAT sources in ../RVCAT)
//   RVCAT_DIR=/path/to/RVCAT npm run update-wheel
//
// Requires Python with pip. The wheel name is fixed (public/worker.js loads it by name).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WHEEL     = 'rvcat-0.1-py3-none-any.whl'
const root      = resolve(import.meta.dirname, '..')
const rvcatDir  = resolve(process.env.RVCAT_DIR ?? join(root, '..', 'RVCAT'))
const python    = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')

if (!existsSync(join(rvcatDir, 'pyproject.toml'))) {
  console.error(`❌ ${rvcatDir} has no pyproject.toml. Set RVCAT_DIR to the RVCAT repository.`)
  process.exit(1)
}

const outDir = mkdtempSync(join(tmpdir(), 'rvcat-wheel-'))
try {
  console.log(`🐍 Building wheel from ${rvcatDir}`)
  execFileSync(python, ['-m', 'pip', 'wheel', '.', '--no-deps', '-q', '-w', outDir],
               { cwd: rvcatDir, stdio: 'inherit' })

  const built = join(outDir, WHEEL)
  if (!existsSync(built)) {
    console.error(`❌ Expected ${WHEEL} was not produced (check the version in pyproject.toml).`)
    process.exit(1)
  }
  copyFileSync(built, join(root, 'public', WHEEL))
  console.log(`✅ public/${WHEEL} updated`)

  try {
    const rev = execFileSync('git', ['-C', rvcatDir, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim()
    console.log(`   RVCAT commit: ${rev}`)
  } catch { /* not a git checkout */ }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
