# Releasing

Maintainer reference for cutting a release of `signalk-activecaptain-resources`.

## Process

Publishing is driven by GitHub Releases. The `Node.js Package` workflow
(`.github/workflows/npm-publish.yml`) fires on the `release: created` event. It
runs in two jobs: the first installs dependencies, runs `npm run build`, and
runs `npm test`; the second reinstalls and runs `npm publish`. The
`prepublishOnly` script cleans and rebuilds `dist/` and `public/` before the
package is published, so the npm tarball always reflects a fresh build.

The workflow requires an `npm_token` repository secret (an npm Automation
token, or a Granular token with publish and read access to this package).

The package's `files` field publishes only `dist/` and `public/`; source,
tests, and docs are not shipped to npm.

## Checklist

Before creating the GitHub release:

1. Bump `version` in `package.json`.
2. Add a new `### vX.Y.Z (YYYY/MM/DD) - <title>` entry at the top of
   `CHANGELOG.md`, with an `<a id="vXYZ"></a>` anchor line directly above the
   heading (digits only, no dots: `v1.2.0` -> `v120`).
3. Run the full local check, and confirm each command passes:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```
4. Update `README.md` and the `docs/` tree if the release changes documented
   behavior, commands, or configuration options.
5. Commit the version bump and changelog entry.
6. Create a GitHub release whose tag matches the new `package.json` version
   (for example, tag `v1.2.0`). Creating the release triggers the publish
   workflow; once it succeeds the new version is live on npm.

## Supported Node.js versions

CI (`.github/workflows/ci.yml`) builds, type-checks, tests, and lints on
Node.js 20 and 22. The publish workflow runs on Node.js 22. Keep the `engines`
field in `package.json` (`>=20`) aligned with the lowest version CI exercises.
