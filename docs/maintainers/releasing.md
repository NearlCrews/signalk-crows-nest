# Releasing

Maintainer reference for cutting a release of `signalk-crows-nest`.

## Process

Publishing is driven by GitHub Releases. The `Node.js Package` workflow
(`.github/workflows/npm-publish.yml`) fires on the `release: created` event. It
runs in two jobs. The first verifies that the release tag matches the
`package.json` version, then installs dependencies and runs `build`,
`typecheck`, `test`, and `lint`. The second reinstalls and runs
`npm publish --provenance` (the job grants the `id-token: write` and
`contents: read` permissions provenance requires). The `prepack` script
cleans and rebuilds `dist/` and `public/` before the package is published, so
the npm tarball always reflects a fresh build.

The workflow reads the `NPM_TOKEN` repository secret (an npm Automation
token, or a Granular token with publish and read access to this package).
Secret names are case-insensitive in GitHub Actions, but `NPM_TOKEN` is the
canonical form.

The package's `files` field publishes `dist/`, `public/`, and `assets/`;
source, tests, and docs are not shipped to npm. The `assets/` directory
carries the SignalK admin-UI icon set (the master SVG plus the four
rasterized PNGs); the `build:icons` script also copies them under
`public/assets/icons/` so the admin's `express.static` mount can serve them.
It also carries `assets/screenshots/`, the images declared under
`signalk.screenshots` for the plugin-registry listing. Both the icons and the
screenshots are git-tracked: the publish workflow checks out only committed
files, so an uncommitted screenshot would ship a tarball with a dangling
`signalk.screenshots` path.

## Checklist

Before creating the GitHub release:

1. Bump the version with `npm version <x.y.z> --no-git-tag-version`, which
   updates both `package.json` and the `package-lock.json` version field so the
   two never drift. (A stale lockfile version is harmless to `npm ci`, which
   validates the dependency tree rather than the project version, but keeping
   them in step avoids confusion.)
2. Add a new `## [X.Y.Z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md`,
   below any `## [Unreleased]` section, with an `<a id="vXYZ"></a>` anchor line
   directly above the heading (digits only, no dots: `0.5.0` -> `v050`). Group
   the changes under `### Added`, `### Changed`, `### Fixed`, and the other Keep
   a Changelog subsections.
3. Run the full local check, and confirm each command passes:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```
4. Update `README.md` and the `docs/` tree if the release changes documented
   behavior, commands, or configuration options.
5. Commit the version bump, the regenerated `package-lock.json`, the changelog
   entry, and any new published assets (for example new `assets/screenshots/`
   images). Confirm with `git status` that nothing under `assets/` is left
   untracked, since the publish workflow ships only committed files.
6. Create a GitHub release whose tag matches the new `package.json` version
   (for example, tag `v0.6.0`). The build job fails fast if the tag and the
   version disagree. Creating the release triggers the publish workflow; once
   it succeeds the new version is live on npm.

## Supported Node.js versions

CI (`.github/workflows/ci.yml`) builds, type-checks, tests, and lints on
Node.js 20 and 22. The official Signal K plugin CI
(`.github/workflows/plugin-ci.yml`) also exercises Node.js 22 and 24 across
Linux, macOS, and Windows, plus its Node.js 20 armv7 lane. The publish workflow
runs on Node.js 22. The `engines` field in `package.json` is `>=20.3.0` (the
ActiveCaptain client uses `AbortSignal.any`, added in Node 20.3); keep it at or
below the lowest Node.js version CI exercises.
