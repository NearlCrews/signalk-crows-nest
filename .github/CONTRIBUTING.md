# Contributing

Thanks for your interest in contributing to Crow's Nest (`signalk-crows-nest`).

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Reporting bugs

Check existing issues first to avoid duplicates, then open a bug report with:

- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, Signal K server version, OS)
- Relevant log output

## Suggesting enhancements

Open a feature request issue describing the proposed feature, the use case it
serves, and any implementation ideas you have.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Follow the [development guide](../docs/development.md) for setup, build, and
   test commands.
3. Make focused commits with clear messages (see below).
4. Add tests for any new functionality and keep the existing suite green.
5. Run `npm run verify` before pushing.
6. Update documentation (`README.md`, `CHANGELOG.md`, `docs/`) as needed.
7. Open a pull request with a clear description of the change.

## Code style

- All source is TypeScript under `src/`. The Node plugin is compiled to
  `dist/` by `tsc`; the React panel under `src/panel/` is bundled to `public/`
  by webpack.
- Keep modules focused and small. Shared types belong in `src/shared/types.ts`.
- Run code, Markdown, and spelling checks with `npm run lint`, or apply safe
  code fixes with `npm run lint:fix`.
- Run `npm run format:check` to verify source, documentation, and configuration
  formatting. `npm run format` applies the corresponding fixes.
- Do not edit `dist/` or `public/`; they are generated build output.
- Default to no comments. Add one only when the WHY is non-obvious (a hidden
  constraint, a subtle invariant, or a workaround).

## TypeScript compilers

`devDependencies` lists two compilers under npm aliases. `@typescript/native`
is the real `typescript` package at 7.x; `npm run build:plugin` and
`npm run typecheck` reach it through `scripts/tsc7.mjs`, which resolves the
compiler by package name because the bare `tsc` binary link depends on install
order. `typescript` is aliased to `@typescript/typescript6`, which supplies the
TypeScript 6 compiler API plus a `tsc6` binary, because typescript-eslint and
knip import that API and do not yet run under TypeScript 7.
`npm run typecheck:ts6` type-checks the same projects under TypeScript 6 so the
two compilers cannot disagree unnoticed. Dependabot does not bump npm-alias
ranges, so check both entries by hand with `npm outdated` when updating
dependencies.

## Architecture rule

This repository ships exactly ONE npm package and ONE Signal K plugin. Keep the
code modular by splitting it into focused files under `src/`. Never split the
project into multiple npm packages or a monorepo. New functionality is a new
module under `src/`, not a new package.

See [CLAUDE.md](../CLAUDE.md) for the full set of project conventions and
[docs/development.md](../docs/development.md) for the module layout and the
build, test, and release commands.

## Commit messages

Use conventional-commit prefixes that match the actual diff scope:

```
feat: expose airport POIs in the config panel
fix: correct longitude normalization in the bounding box helper
docs: update installation instructions
test: add tests for the POI cache TTL
chore: update dependencies
```

## License and attribution

By contributing, you agree your contributions are licensed under the MIT
License that covers this project. The plugin imports data from Garmin
ActiveCaptain, OpenStreetMap via the Overpass API, USCG Light List and Local
Notice to Mariners, NOAA ENC Direct and CO-OPS, NGA World Port Index, and
USACE. Every published note carries its source credit on the structured
`properties.attribution` field; keep that attribution intact for every
source. The OpenStreetMap data is published under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/),
which requires visible attribution wherever the data is shown.
