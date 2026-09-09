/**
 * Contract test for the panel's Babel JSX transform.
 *
 * The regression this locks out: preset-react can derive its `development`
 * option from the Babel environment, which falls back to "development" when
 * NODE_ENV is unset, as it is during `npm run build:panel`. That emits
 * `jsxDEV` imports from react/jsx-dev-runtime, the remote bundles React's
 * PRODUCTION copy of that module (only the package-root `react` request is
 * federation-shared, not the `react/jsx-dev-runtime` subpath),
 * and production React deliberately leaves `jsxDEV` unimplemented, so the
 * panel throws "jsxDEV is not a function" at first render. The webpack config
 * must therefore pin `development: false`; this test runs the config's actual
 * preset list through Babel and asserts the production automatic runtime.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

interface BabelLoaderRule {
  loader: string
  options: { presets: unknown[] }
}

interface WebpackConfig {
  module: { rules: BabelLoaderRule[] }
  plugins: Array<{
    options?: {
      shared?: Record<string, {
        import?: boolean
        requiredVersion?: string
        singleton?: boolean
      }>
    }
  }>
}

const webpackConfig = require('../webpack.config.cjs') as WebpackConfig

// Babel 8 requires Node 22.18 or newer. The Node 20 CI leg verifies the plugin
// runtime only and never builds the panel, so the transform check has nothing
// to prove there and skips itself rather than failing on a toolchain the leg
// does not run.
const NODE_MAJOR = Number(process.versions.node.split('.')[0])
const BABEL_SKIP = NODE_MAJOR >= 22 ? false : 'Babel 8 needs Node 22.18 or newer; this Node checks the plugin runtime only'

test('the panel JSX transform emits the production automatic runtime', { skip: BABEL_SKIP }, () => {
  const babel = require('@babel/core') as {
    transformSync: (code: string, options: object) => { code: string } | null
  }
  const rule = webpackConfig.module.rules.find((r) => r.loader === 'babel-loader')
  assert.ok(rule !== undefined)
  const out = babel.transformSync('export const probe = <div />', {
    filename: 'probe.tsx',
    presets: rule.options.presets,
    configFile: false,
    babelrc: false
  })
  assert.ok(out !== null)
  assert.match(out.code, /react\/jsx-runtime/)
  assert.doesNotMatch(out.code, /jsx-dev-runtime/)
  assert.doesNotMatch(out.code, /jsxDEV/)
})

test('React and React DOM are host-provided singletons while the UI stays bundled', () => {
  const federation = webpackConfig.plugins.find((plugin) => plugin.options?.shared !== undefined)
  assert.ok(federation?.options?.shared !== undefined)
  // The config spreads the share map the shared UI package publishes, so the
  // remote is verified against exactly the map the library was tested with:
  // React and React DOM as non-strict singletons with no bundled fallback.
  // strictVersion must stay absent: Signal K Admin releases up to at least
  // 2.24.0 register their React share as 19.0.0 while shipping a newer React,
  // so a strict check would reject a healthy host and the panel would never
  // mount.
  const published = require('signalk-nearlcrews-ui/federation') as { shared: unknown }
  assert.deepEqual(federation.options.shared, published.shared)
  assert.deepEqual(Object.keys(federation.options.shared).sort(), ['react', 'react-dom'])
  for (const packageName of ['react', 'react-dom']) {
    assert.equal(federation.options.shared[packageName]?.singleton, true)
    assert.equal(federation.options.shared[packageName]?.import, false)
    assert.equal('strictVersion' in (federation.options.shared[packageName] ?? {}), false)
  }
})
