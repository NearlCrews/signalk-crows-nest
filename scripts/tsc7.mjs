/**
 * Runs the TypeScript 7 compiler that `@typescript/native` installs.
 *
 * `devDependencies` carries two compilers under npm aliases: `typescript`
 * resolves to `@typescript/typescript6`, so tools that import the compiler
 * API (typescript-eslint through neostandard, and knip) get the TypeScript 6
 * API they support, while `@typescript/native` is the real `typescript`
 * package at 7.x that builds and type-checks this repository. The shim's own
 * dependency on TypeScript 6 also declares a `tsc` binary, so which package
 * `node_modules/.bin/tsc` links to depends on install order. This wrapper
 * resolves the native compiler by package name instead, so `npm run build`
 * and `npm run typecheck` always run TypeScript 7 regardless of that link.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const manifestPath = require.resolve('@typescript/native/package.json')
const manifest = require(manifestPath)
const binary = join(dirname(manifestPath), manifest.bin.tsc)

const result = spawnSync(process.execPath, [binary, ...process.argv.slice(2)], { stdio: 'inherit' })
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
