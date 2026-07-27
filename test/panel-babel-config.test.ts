/**
 * Contract test for the panel's Babel JSX transform.
 *
 * The regression this locks out: Babel 8's preset-react defaults its
 * `development` option to the Babel env, which falls back to "development"
 * when NODE_ENV is unset, as it is during `npm run build:panel`. That emits
 * `jsxDEV` imports from react/jsx-dev-runtime, the remote bundles React's
 * PRODUCTION copy of that module (only `react` itself is federation-shared),
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
