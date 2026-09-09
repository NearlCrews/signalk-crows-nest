import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { normalizePackReport } from './package-report.mjs'

const execFileAsync = promisify(execFile)
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const { stdout } = await execFileAsync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { maxBuffer: 10 * 1024 * 1024 }
)
const packResult = normalizePackReport(JSON.parse(stdout))
const files = new Set(packResult.files.map((file) => file.path))
const normalizeDeclaredPath = (declaredPath) => declaredPath.replace(/^\.\//, '')

for (const requiredPath of [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.js.map',
  'package.json',
  'public/remoteEntry.js'
]) {
  if (!files.has(requiredPath)) throw new Error(`Packed package is missing ${requiredPath}.`)
}

const rootExport = packageJson.exports?.['.']
const declaredEntrypoints = [
  ['main', packageJson.main],
  ['types', packageJson.types],
  ['exports["."].require', rootExport?.require],
  ['exports["."].types', rootExport?.types]
]
for (const [field, declaredPath] of declaredEntrypoints) {
  if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
    throw new Error(`${field} must declare a non-empty package-relative entrypoint.`)
  }
  const packedPath = normalizeDeclaredPath(declaredPath.trim())
  if (packedPath.startsWith('../') || packedPath.startsWith('/') || !files.has(packedPath)) {
    throw new Error(`${field} does not resolve to packed file ${packedPath}.`)
  }
}

if (![...files].some((file) => /^public\/.+\.js$/.test(file))) {
  throw new Error('Packed package is missing the panel JavaScript chunks.')
}

// The readdir sweep below only proves that whatever public/ happens to hold
// got packed, so a partial build packs cleanly. webpack owns public/ and
// wipes it, so running build:panel after a full build removes the icons
// build:icons copied in, and nothing downstream notices. Name the expected
// icons instead of trusting the directory to be complete.
for (const iconName of await readdir('assets/icons')) {
  if (iconName !== 'icon.svg' && !(iconName.startsWith('icon-') && iconName.endsWith('.png'))) {
    continue
  }
  if (!files.has(`public/assets/icons/${iconName}`)) {
    throw new Error(
      `Packed package is missing panel icon public/assets/icons/${iconName}. Run the full build.`
    )
  }
}
for (const entry of await readdir('public', { withFileTypes: true })) {
  if (entry.isFile() && !files.has(`public/${entry.name}`)) {
    throw new Error(`Packed package is missing generated panel asset public/${entry.name}.`)
  }
}

const declaredAssets = [
  ['signalk.appIcon', packageJson.signalk?.appIcon],
  ...(packageJson.signalk?.screenshots ?? []).map((declaredPath, index) => [
    `signalk.screenshots[${index}]`,
    declaredPath
  ])
]
for (const [field, declaredPath] of declaredAssets) {
  if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
    throw new Error(`${field} must declare a non-empty package-relative asset path.`)
  }
  const packedPath = normalizeDeclaredPath(declaredPath.trim())
  if (packedPath.startsWith('../') || packedPath.startsWith('/') || !files.has(packedPath)) {
    throw new Error(`${field} does not resolve to packed file ${packedPath}.`)
  }
}

for (const file of files) {
  if (
    file.startsWith('src/') ||
    file.startsWith('test/') ||
    file.startsWith('tests/') ||
    file.startsWith('fixtures/') ||
    file.startsWith('docs/superpowers/') ||
    file.startsWith('.tmp/')
  ) {
    throw new Error(`Packed package contains development-only file ${file}.`)
  }
}

// The shared UI must stay a bundled development dependency: it ships inside
// the panel remote, never as a runtime dependency of the plugin. The exact
// pin, its agreement with the installed package, the version stamp in the
// built remote, the host share map, and the size baseline are asserted by the
// library's own `snui-check-consumer` command (`npm run check:panel`).
if (packageJson.dependencies?.['signalk-nearlcrews-ui']) {
  throw new Error('signalk-nearlcrews-ui must be a bundled development dependency.')
}

// THIRD_PARTY_NOTICES.md ships in the tarball, so it is a published
// attribution record for the code the panel bundle redistributes. It is
// generated from webpack's own module graph rather than hand-maintained, and
// `npm run licenses:check` (wired into package:check beside this script)
// verifies the committed file still describes the installed tree. Only its
// presence in the tarball is this script's business.
if (!files.has('THIRD_PARTY_NOTICES.md')) {
  throw new Error('Packed package is missing THIRD_PARTY_NOTICES.md.')
}

// @types/node describes the runtime the plugin actually advertises, so it must
// track the LOWEST major in engines.node. A newer major would let an API that
// does not exist on the floor typecheck here and fail there, which is exactly
// the failure a type checker exists to prevent. Derived rather than pinned to
// a literal so raising the floor cannot leave the types behind.
const engineMajors = [...(packageJson.engines?.node ?? '').matchAll(/(\d+)(?:\.\d+)*/g)]
  .map((match) => Number(match[1]))
if (engineMajors.length === 0) throw new Error('engines.node declares no version.')
const floorMajor = Math.min(...engineMajors)
const typesRange = packageJson.devDependencies?.['@types/node'] ?? ''
const typesMajor = Number(/(\d+)/.exec(typesRange)?.[1])
if (typesMajor !== floorMajor) {
  throw new Error(
    `@types/node is ${typesRange} but engines.node floors at Node ${floorMajor}; they must share a major.`
  )
}

console.log(`Packed package passed: ${files.size} files in ${packResult.filename}.`)
