/**
 * Bundles the configuration panel with webpack when this Node can run the
 * panel toolchain, and otherwise prints a notice and exits successfully.
 *
 * `npm run build` runs on the lowest Node the plugin advertises, through the
 * Signal K plugin CI's advisory armv7 Node 20 lane, to prove the plugin
 * installs, compiles, and passes its tests there. The panel is a prebuilt
 * release artifact in `public/`: a Node 20 machine installing from npm never
 * builds it, and Babel 8 cannot run there, so skipping the bundle on such a
 * Node keeps that lane meaningful instead of failing it at a step the runtime
 * does not need.
 */

import { spawnSync } from 'node:child_process'
import { PANEL_TOOLCHAIN_FLOOR_TEXT, supportsPanelToolchain } from './panel-toolchain.mjs'

const nodeVersion = process.versions.node
if (!supportsPanelToolchain(nodeVersion)) {
  process.stdout.write(
    `Skipping the panel build on Node ${nodeVersion}: the panel toolchain (Babel 8) requires ` +
    `${PANEL_TOOLCHAIN_FLOOR_TEXT}. The plugin still compiles and tests here; public/ is a ` +
    'prebuilt release artifact that a Node 20 install never rebuilds.\n'
  )
  process.exit(0)
}

const result = spawnSync(
  process.execPath,
  ['node_modules/webpack-cli/bin/cli.js', '--config', 'webpack.config.cjs', ...process.argv.slice(2)],
  { stdio: 'inherit' }
)
if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
