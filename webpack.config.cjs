'use strict'

const path = require('node:path')
const webpack = require('webpack')
const pkg = require('./package.json')
// The Module Federation share map the shared UI package was verified with:
// React and React DOM as host-owned, non-strict singletons with no bundled
// fallback. Read `hostNotes` from the same entry for why the shares are not
// strict.
const { shared } = require('signalk-nearlcrews-ui/federation')

// The Admin publishes its dependency inventory as
// @signalk/server-admin-ui-dependencies, and the usual advice is to require it
// here so a React drift from the host fails the build. This package
// deliberately does not, for three reasons.
//
// Requiring it would end the build outright. Its index.js validates peers when
// it loads and calls process.exit(-1) on any that are missing, and it asks for
// bootstrap, font-awesome, @fortawesome/fontawesome-free, react-bootstrap,
// react-select, and simple-line-icons. This panel uses none of those, so the
// guard would fail until six unused UI libraries were installed to appease it.
//
// It would also assert less than the line above already does. The inventory
// asks for React ^19.0.0, while the shared UI requires ^19.2.0, so the check
// would pass on versions this panel's own peer rejects.
//
// And it lags the Admin it describes: the inventory is 2.23.0 while the Admin
// is 2.32.0, so a drift it reported would be its own rather than this panel's.
// That is the failure mode already seen once here, when the Admin registered
// its React share as 19.0.0 while bundling 19.2.4 and a version comparison
// against the host's own number kept a compatible panel from mounting.
//
// The property is covered another way: `npm run check:panel` asserts this
// build consumes the published share map unchanged, and its --runtime mode
// renders the panel under the host's own share scope.

// The SignalK admin UI looks up a configurator panel on window[<safeName>],
// so the Module Federation container name must be the package name with any
// non-word characters replaced.
const safeName = pkg.name.replace(/[-@/]/g, '_')

module.exports = {
  // No `entry`: this is a pure Module Federation remote. The admin UI loads
  // only remoteEntry.js and the exposed panel chunk, so a host entry bundle
  // would just be dead weight in the published tarball.
  entry: {},
  mode: 'production',
  output: {
    path: path.resolve(__dirname, 'public'),
    // remoteEntry.js keeps its fixed name (set on the plugin below) so the
    // admin UI can always find it; the panel chunk is content-hashed so a
    // changed build cannot be served stale from a browser cache.
    chunkFilename: '[name].[contenthash].js',
    // Wipe stale bundles and chunks on each build: public/ holds nothing but
    // this webpack output, so a renamed or removed chunk leaves no orphan.
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: {
          presets: [
            // JSX parsing keys off the .tsx extension, which matches this
            // rule's file set without applying TypeScript JSX parsing to .ts.
            '@babel/preset-typescript',
            // Keep development false even when NODE_ENV is unset so the
            // production build never emits jsxDEV calls.
            ['@babel/preset-react', { runtime: 'automatic', development: false }]
          ]
        }
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    // Resolve ESM-style ".js" specifiers onto sibling ".ts"/".tsx" sources, so
    // panel code can import the shared plugin modules with the same node16
    // ".js" import convention the Node build uses.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js']
    }
  },
  plugins: [
    new webpack.container.ModuleFederationPlugin({
      name: safeName,
      // Classic "var" container: remoteEntry.js assigns the panel to the
      // global window[safeName], which is how the SignalK admin UI finds
      // configurator panels.
      library: { type: 'var', name: safeName },
      filename: 'remoteEntry.js',
      exposes: {
        // Expose the index module so its re-export is the federation surface
        // rather than dead code beside the panel.
        './PluginConfigurationPanel': './src/panel/index.tsx'
      },
      // The shared UI package is intentionally absent from this map so it
      // remains bundled with the remote while both React packages resolve from
      // Signal K Admin.
      shared
    })
  ]
}
