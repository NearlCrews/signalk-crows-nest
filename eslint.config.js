'use strict'

const neostandard = require('neostandard')
const react = require('eslint-plugin-react')

module.exports = [
  ...neostandard({
    ts: true,
    ignores: [
      'dist/', 'node_modules/', 'public/', '.remember/', 'coverage/',
      // Sibling clone parked in the working tree for cross-reference; not
      // part of this project and not subject to its lint rules.
      'src/freeboard-sk/'
    ]
  }),
  // The configurator panel is React. Scope the React rule set to it so the
  // Node plugin sources are unaffected.
  {
    ...react.configs.flat.recommended,
    files: ['src/panel/**/*.{ts,tsx}'],
    settings: { react: { version: 'detect' } }
  },
  {
    ...react.configs.flat['jsx-runtime'],
    files: ['src/panel/**/*.{ts,tsx}']
  }
]
