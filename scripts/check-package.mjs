import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { normalizePackReport } from './package-report.mjs'

const execFileAsync = promisify(execFile)
const EXPECTED_SHARED_UI_VERSION = '0.8.0'
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

if (packageJson.dependencies?.['signalk-nearlcrews-ui']) {
  throw new Error('signalk-nearlcrews-ui must be a bundled development dependency.')
}
const sharedUiVersion = packageJson.devDependencies?.['signalk-nearlcrews-ui']
if (sharedUiVersion !== EXPECTED_SHARED_UI_VERSION) {
  throw new Error(`The UI package must be pinned to exact version ${EXPECTED_SHARED_UI_VERSION}.`)
}

// THIRD_PARTY_NOTICES.md ships in the tarball, so it is a published
// attribution record for the code inside the panel bundle. A dependency bump
// that leaves it behind publishes a wrong one, silently: nothing else reads
// the file. These two are what the emitted chunks actually contain, so the
// notices drift fails the gate instead of the release. Membership was checked
// against the emitted files and webpack's extracted license banner, not the
// module graph: the graph also lists modules that are resolved and then
// eliminated, which is why react-aria appears there but ships nothing.
const notices = await readFile('THIRD_PARTY_NOTICES.md', 'utf8')
for (const bundledPackage of ['signalk-nearlcrews-ui', 'react']) {
  const { version } = JSON.parse(
    await readFile(`node_modules/${bundledPackage}/package.json`, 'utf8')
  )
  if (!notices.includes(`\`${bundledPackage}\` ${version},`)) {
    throw new Error(
      `THIRD_PARTY_NOTICES.md does not attribute ${bundledPackage} ${version}, which the panel bundles.`
    )
  }
}

console.log(`Packed package passed: ${files.size} files in ${packResult.filename}.`)
