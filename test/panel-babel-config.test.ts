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

const babel = require('@babel/core') as {
  transformSync: (code: string, options: object) => { code: string } | null
}

test('the panel JSX transform emits the production automatic runtime', () => {
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
  const shared = federation.options.shared
  assert.deepEqual(Object.keys(shared).sort(), ['react', 'react-dom'])
  for (const packageName of ['react', 'react-dom']) {
    assert.deepEqual(shared[packageName], {
      singleton: true,
      requiredVersion: '^19.2.0',
      import: false
    })
  }
})
