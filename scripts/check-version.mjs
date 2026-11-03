// Checks that package.json "version" matches RVCAT_VERSION in src/common.js
// (RVCAT_VERSION '1.14' <-> package.json '1.14.x').
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root    = resolve(import.meta.dirname, '..')
const pkg     = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const common  = readFileSync(join(root, 'src', 'common.js'), 'utf8')
const match   = common.match(/export const RVCAT_VERSION\s*=\s*['"]([^'"]+)['"]/)

if (!match) {
  console.error('❌ RVCAT_VERSION not found in src/common.js')
  process.exit(1)
}

const appVersion = match[1]
if (pkg.version !== appVersion && !pkg.version.startsWith(`${appVersion}.`)) {
  console.error(`❌ Version mismatch: package.json is ${pkg.version}, RVCAT_VERSION is ${appVersion}`)
  process.exit(1)
}
console.log(`✅ Version ${appVersion} (package.json ${pkg.version})`)
