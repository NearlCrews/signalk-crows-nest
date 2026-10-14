import assert from 'node:assert/strict'
import { findRelativeLinkTargets } from './readme-links.mjs'

assert.deepEqual(
  findRelativeLinkTargets(
    '[site](https://signalk.org) [mail](mailto:a@example.com) [top](#requirements) <http://example.com>'
  ),
  [],
  'absolute links, mail links, and in-page anchors resolve in the App Store'
)
assert.deepEqual(
  findRelativeLinkTargets('[Changelog](CHANGELOG.md), [guide](./docs/development.md), [license](../LICENSE)'),
  ['CHANGELOG.md', './docs/development.md', '../LICENSE'],
  'relative file links are dead in the App Store'
)
assert.deepEqual(
  findRelativeLinkTargets('[Changelog](CHANGELOG.md "Release history") and [empty]()'),
  ['CHANGELOG.md', ''],
  'a title does not hide the target, and an empty target is dead'
)
assert.deepEqual(
  findRelativeLinkTargets('See the [contributing\nguide](.github/CONTRIBUTING.md).'),
  ['.github/CONTRIBUTING.md'],
  'link text may wrap across lines'
)
assert.deepEqual(
  findRelativeLinkTargets('![Panel](assets/screenshots/admin-panel.png) <img src="assets/icons/icon.svg">'),
  [],
  'relative image paths are rewritten against the package root'
)
assert.deepEqual(
  findRelativeLinkTargets(
    '[![CI](https://example.com/badge.svg)](https://example.com/ci) [![License](https://example.com/l.svg)](LICENSE)'
  ),
  ['LICENSE'],
  'a badge image is exempt while the link around it is still checked'
)
assert.deepEqual(
  findRelativeLinkTargets('[docs]: docs/development.md\n[site]: https://signalk.org\n[^1]: A footnote, not a target.'),
  ['docs/development.md'],
  'reference definitions are checked and footnotes are not'
)
assert.deepEqual(
  findRelativeLinkTargets('<a href="docs/troubleshooting.md">help</a> <a class="x" href=\'https://signalk.org\'>site</a>'),
  ['docs/troubleshooting.md'],
  'HTML anchors are checked'
)
assert.deepEqual(
  findRelativeLinkTargets('```md\n[guide](docs/development.md)\n```\nUse `[x](y.md)` syntax. <!-- [c](CHANGELOG.md) -->'),
  [],
  'code blocks, inline code, and comments carry no live links'
)

process.stdout.write('README link guard tests passed.\n')
