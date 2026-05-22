# Contributing

Thanks for your interest in contributing to Signal K ActiveCaptain Resources.

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
5. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`
   before pushing.
6. Update documentation (`README.md`, `CHANGELOG.md`, `docs/`) as needed.
7. Open a pull request with a clear description of the change.

## Code style

- All source is TypeScript under `src/`. The Node plugin is compiled to
  `dist/` by `tsc`; the React panel under `src/panel/` is bundled to `public/`
  by webpack.
- Keep modules focused and small. Shared types belong in `src/types.ts`.
- Lint with ESLint 9 and [neostandard](https://github.com/neostandard/neostandard)
  (`npm run lint`, or `npm run lint:fix` to auto-fix).
- Do not edit `dist/` or `public/`; they are generated build output.
- Default to no comments. Add one only when the WHY is non-obvious (a hidden
  constraint, a subtle invariant, or a workaround).

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
License that covers this project. The plugin imports community-contributed data
from the Garmin ActiveCaptain API; keep the "Data sourced from Garmin Active
Captain" attribution in any rendered output.
