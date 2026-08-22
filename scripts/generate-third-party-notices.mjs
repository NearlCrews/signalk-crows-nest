import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * The configuration panel is a Module Federation remote, so everything webpack
 * folds into `public/*.js` is redistributed inside this package. MIT requires
 * the copyright and permission notice to travel with a copy, and Apache-2.0
 * section 4(a) requires giving recipients the license. Terser only extracts
 * comments carrying an `@license` or `@preserve` marker, and most of this tree
 * ships none, so the emitted `.LICENSE.txt` sidecar discharges neither.
 *
 * The plugin itself needs no entry: `tsc` emits `dist/` without bundling, and
 * its two runtime dependencies reach the user through npm with their own
 * licenses intact.
 *
 * Run `npm run licenses` to regenerate, which costs a webpack build. The
 * `--check` mode used by the package gate verifies the committed file still
 * describes the installed tree without paying for one.
 *
 * The package list comes from webpack's own module graph rather than a
 * dependency list. Scope hoisting means a bundled module can report no chunk
 * of its own while its code is emitted inside a concatenated parent, so the
 * graph is the reliable enumeration and grepping for a package name is not:
 * minification strips the module paths a name search would look for.
 */

const repositoryDir = new URL('../', import.meta.url)
const noticesUrl = new URL('THIRD_PARTY_NOTICES.md', repositoryDir)
const checkOnly = process.argv.includes('--check')

const HEADER_MARKER = '<!-- generated-for-signalk-nearlcrews-ui:'

const sharedUiVersion = JSON.parse(
  readFileSync(new URL('package.json', repositoryDir), 'utf8')
).devDependencies['signalk-nearlcrews-ui']
if (typeof sharedUiVersion !== 'string' || sharedUiVersion.length === 0) {
  throw new Error('package.json does not pin signalk-nearlcrews-ui')
}

/** Ask webpack which packages it actually bundles, rather than guessing. */
function bundledPackageNames () {
  const result = spawnSync(
    process.execPath,
    ['node_modules/webpack-cli/bin/cli.js', '--config', 'webpack.config.cjs', '--json'],
    { cwd: repositoryDir.pathname, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  )
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '')
    throw new Error('webpack did not produce a module list')
  }
  const stats = JSON.parse(result.stdout)
  const names = new Set()
  // Concatenation nests the real records under `modules`, and a child
  // compilation would nest them under `children`, so both are followed. Chunk
  // membership is deliberately NOT used as a filter: a concatenated module
  // reports an empty chunk list while its code is emitted inside its parent.
  const walk = (module) => {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(module.name ?? '')
    if (match?.[1] !== undefined) names.add(match[1])
    for (const nested of module.modules ?? []) walk(nested)
    for (const child of module.children ?? []) walk(child)
  }
  for (const module of stats.modules ?? []) walk(module)
  for (const child of stats.children ?? []) {
    for (const module of child.modules ?? []) walk(module)
  }
  // webpack's own bootstrap, chunk loader, and share-scope runtime are emitted
  // into the chunks without ever appearing as node_modules entries, so the
  // module walk cannot see them. Attribute webpack when that runtime ships.
  const emitsRuntime = (stats.chunks ?? []).some((chunk) =>
    (chunk.modules ?? []).some(
      (module) => module.moduleType === 'runtime' ||
        (module.identifier ?? '').includes('webpack/runtime')
    )
  )
  if (emitsRuntime) names.add('webpack')
  return [...names].sort()
}

function licenseTextFor (name) {
  for (const candidate of ['LICENSE', 'license', 'LICENSE.md', 'LICENSE.txt']) {
    const url = new URL(`node_modules/${name}/${candidate}`, repositoryDir)
    // Normalize line endings: a package shipping CRLF would otherwise leave
    // the generated file permanently dirty against the repository's LF rules.
    if (existsSync(url)) return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n').trim()
  }
  return null
}

function licenseIdFor (name) {
  const manifest = JSON.parse(
    readFileSync(new URL(`node_modules/${name}/package.json`, repositoryDir), 'utf8')
  )
  return typeof manifest.license === 'string' ? manifest.license : 'see below'
}

function versionFor (name) {
  const manifest = JSON.parse(
    readFileSync(new URL(`node_modules/${name}/package.json`, repositoryDir), 'utf8')
  )
  return manifest.version
}

function render (names) {
  const sections = names.map((name) => {
    const text = licenseTextFor(name)
    const body = text === null
      ? `This package ships no license file. Its manifest declares ${licenseIdFor(name)}.`
      : `\`\`\`text\n${text}\n\`\`\``
    return `## ${name}\n\nVersion: ${versionFor(name)}\n\nLicense: ${licenseIdFor(name)}\n\n${body}`
  })
  return [
    '# Third-party notices',
    `${HEADER_MARKER}${sharedUiVersion} -->`,
    'The configuration panel is a Module Federation remote, so the packages below are bundled into `public/*.js` and redistributed with this plugin. Their licenses follow. Regenerate with `npm run licenses` after any change to the panel dependency tree.',
    'React is supplied by the Signal K admin host as a Module Federation singleton and is not bundled here; the React entry that does appear is the JSX runtime, which is imported by subpath and so resolves out of the remote rather than the host. The plugin code under `dist/` is compiled, not bundled, and carries no third-party code.',
    ...sections
  ].join('\n\n')
}

if (checkOnly) {
  if (!existsSync(noticesUrl)) {
    throw new Error('THIRD_PARTY_NOTICES.md is missing; run npm run licenses')
  }
  const current = readFileSync(noticesUrl, 'utf8')
  if (!current.includes(`${HEADER_MARKER}${sharedUiVersion} -->`)) {
    throw new Error(
      `THIRD_PARTY_NOTICES.md was generated for a different signalk-nearlcrews-ui than ${sharedUiVersion}; run npm run licenses`
    )
  }
  // Every package the file names must still resolve, at the version and
  // license it claims. That catches an uninstalled package, a bump, and a
  // relicense without paying for a webpack build.
  const listed = [...current.matchAll(/^## (\S+)$/gm)].map((match) => match[1])
  if (listed.length === 0) throw new Error('THIRD_PARTY_NOTICES.md lists no packages')
  for (const name of listed) {
    if (!existsSync(new URL(`node_modules/${name}/package.json`, repositoryDir))) {
      throw new Error(`THIRD_PARTY_NOTICES.md names ${name}, which is no longer installed`)
    }
    const declaredVersion = versionFor(name)
    const declaredLicense = licenseIdFor(name)
    if (!current.includes(`## ${name}\n\nVersion: ${declaredVersion}\n\nLicense: ${declaredLicense}\n`)) {
      throw new Error(
        `${name} is now ${declaredVersion} under ${declaredLicense}; run npm run licenses`
      )
    }
  }
  process.stdout.write(`Third-party notices cover ${listed.length} bundled packages.\n`)
} else {
  const names = bundledPackageNames()
  if (names.length === 0) throw new Error('webpack reported no bundled packages')
  writeFileSync(noticesUrl, `${render(names)}\n`)
  process.stdout.write(`Wrote THIRD_PARTY_NOTICES.md for ${names.length} bundled packages.\n`)
}
