# Releasing

Maintainer reference for cutting a release of `signalk-crows-nest`.

## Process

Publishing is driven by GitHub Releases. The `Node.js Package` workflow
(`.github/workflows/npm-publish.yml`) fires on the `release: created` event. It
runs in two jobs. The first verifies that the release tag matches the
`package.json` version, installs the browser engines, runs
`npm run verify:release`, and packs the verified package. The second downloads
that exact tarball and publishes it with provenance. This handoff ensures the
registry artifact is the one that passed the complete release gate. The
publish job grants the `id-token: write` and `contents: read` permissions
provenance requires. `pack:release` also records the tagged commit as
`gitHead` inside the tarball. After publication, the workflow reads that field
back from npm and fails unless it matches the release checkout.

The workflow reads the `NPM_TOKEN` repository secret (an npm Automation
token, or a Granular token with publish and read access to this package).
Secret names are case-insensitive in GitHub Actions, but `NPM_TOKEN` is the
canonical form.

The package's `files` field publishes `dist/`, `public/`, `assets/`,
`CHANGELOG.md`, and `THIRD_PARTY_NOTICES.md`. npm also includes `package.json`,
`README.md`, and `LICENSE` by default; source, tests, and the rest of `docs/`
are not shipped. The `assets/` directory carries the Signal K admin UI icon
set (the master SVG plus the two rasterized PNGs); the `build:icons` script
also copies them under
`public/assets/icons/` so the admin's `express.static` mount can serve them. It
also carries `assets/screenshots/`, the images declared under
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
   a Changelog subsections. Then, at the foot of the file, repoint
   `[Unreleased]` at the new tag and add a `[X.Y.Z]` compare link beneath it.
   Those definitions start at 0.15.5 and are maintained forward only, so do not
   backfill the releases below it. The anchors, not the compare links, are what
   the README deep-links to.
3. Run the full local release check:

   ```bash
   npm run verify:release
   ```

   This gate includes code and documentation checks, type checking, coverage,
   production builds, the cross-browser panel matrix, accessibility checks,
   the shared UI consumer check with its panel size baseline and its host-style
   render of the built panel, packed-package validation, and the runtime
   dependency audit. Inspect the package-check output, not only its exit code.

   Two audits exist and only one gates a release. `npm run audit:runtime`
   covers the tree a consumer installs, which is also what the Signal K
   plugin registry scores, so it blocks. `npm run audit:full` covers the
   development toolchain, where an advisory carries no runtime exposure for
   an operator and sometimes has no upstream fix to take, so it runs as its
   own reporting job in CI and does not hold up a release. Read it before
   every release and take any fix that exists; do not add an allowlist to
   either one.

4. Update `README.md`, `CHANGELOG.md`, and the `docs/` tree if the release
   changes documented behavior, commands, or configuration options. Three of
   these go stale every release and are easy to miss:
   - Overwrite the README's `## What's new in X.Y.Z` section so it describes
     this release alone. It is a single current section, never an accumulating
     list, and its heading must match the `package.json` version.
   - Move the supported-version table in `.github/SECURITY.md` to the new
     minor line.
   - Re-check every version number the documentation states as current, which
     today means the `@signalk/server-api` floor and the exact
     `signalk-nearlcrews-ui` pin in `README.md`, `CLAUDE.md`, and
     `docs/development.md`.
5. Review the package metadata and plugin-registry inputs: description,
   categories, engine range, icon path, screenshot paths, screenshot alt text,
   repository links, and funding link. Open every current screenshot and
   confirm it matches the release UI. Regenerate the panel image reproducibly
   with `npm run screenshot:panel` when the panel changes.
6. Refresh `signalk.recommends`. This is a standing item on every release, not
   one-time setup: the App Store resolves the entries by npm package name and
   renders them as "Works well with". List a plugin only where data actually
   flows between it and this one, or where one consumes or enables the other's
   output in a way an operator runs them together. Shared authorship or a
   shared theme is not enough, and a loosely related entry is worse than a
   shorter list. Leave out alternatives, competitors, forks of upstream, and
   this package itself. Check whether a companion has been published since the
   last release, and confirm each candidate is live on npm, because an
   unpublished repository cannot appear in the listing.
7. Commit the version bump, the regenerated `package-lock.json`, the changelog
   entry, and any new published assets (for example new `assets/screenshots/`
   images). Confirm with `git status` that nothing under `assets/` is left
   untracked, since the publish workflow ships only committed files.
8. Push the preparation commit and confirm the CI, ESLint, and Signal K Plugin
   CI workflows pass on that exact commit.
9. Get explicit final approval before creating a tag or GitHub release. A
   GitHub release immediately triggers npm publication, so preparing and
   pushing the release commit is not approval to publish it.
10. After approval, create a GitHub release whose tag matches the new
    `package.json` version (for example, tag `v0.6.0`). The build job fails fast
    if the tag and version disagree. Watch the `Node.js Package` workflow to
    completion, confirm Signal K Plugin CI ran on the tagged commit, and verify
    the GitHub release, npm version, npm `latest` tag, registry `gitHead`, and
    provenance statement before calling the release complete.

## Supported Node.js versions

CI (`.github/workflows/ci.yml`) compiles the plugin, type-checks, runs the
node tests, lints, and audits on Node.js 20 for runtime compatibility, and
runs the full gate on Node.js 22. The Node.js 20 leg does not build the panel:
Babel 8 requires Node.js 22.18 or newer (or 24.11 or newer), so the panel
toolchain is exercised
on Node.js 22 and 24 only. The official Signal K plugin CI
(`.github/workflows/plugin-ci.yml`) exercises Node.js 22 and 24 across Linux,
macOS, and Windows, plus its advisory Node.js 20 armv7 lane, where
`npm run build` skips the panel bundle with a notice and the lane proves the
plugin installs, compiles, and passes its tests on the lowest Node it
advertises. The publish workflow runs on Node.js 22. The `engines` field in `package.json` is
`^20.3.0 || >=22` (the ActiveCaptain client uses `AbortSignal.any`, added in
Node 20.3, and `lru-cache` excludes Node 21); keep its floor at or below the
lowest Node.js version CI exercises.
