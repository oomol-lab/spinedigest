# Releasing SpineDigest

This document is for maintainers who build, validate, and publish the npm package.

It covers the package shape, the local verification flow, and the GitHub Actions release path. User-facing install and usage documentation stays in `README` and `docs/en` / `docs/zh-CN`.

## Package Model

SpineDigest publishes a single npm package that serves both roles:

- a CLI installed as `spinedigest`
- a library imported from `spinedigest`

The package currently targets Node `>=22.12.0`.

Published files are intentionally limited to:

- `data/`
- `dist/`
- `LICENSE`

The current `dist/` contract is:

- `dist/index.cjs`: CommonJS library bundle
- `dist/index.js`: thin ESM wrapper for the library bundle
- `dist/index.d.ts`: ESM-facing types
- `dist/index.d.cts`: CommonJS-facing types
- `dist/cli.cjs`: CommonJS CLI bundle
- `dist/cli.js`: thin executable wrapper for the CLI bundle
- `*.map`: source maps kept for production debugging

The CLI and library are allowed to duplicate code. Compact output is less important than predictable installation and compatibility.

## Build Policy

The build uses `tsup` to produce bundled CommonJS outputs plus thin ESM wrappers.

Current policy:

- keep source maps in published output
- do not aggressively minify or uglify release bundles
- keep `sqlite3` as a normal runtime dependency
- do not try to inline native `sqlite3` binaries into the package

This means install failures caused by unsupported `sqlite3` environments are treated as unsupported environments, not something the package works around.

## Local Verification

Use these commands before touching the release workflow:

```bash
pnpm release:check
```

That command runs the maintainer validation path:

- `pnpm verify`
- `pnpm test:run`
- `pnpm build`
- `pnpm smoke:pack-install`
- `pnpm publish:dry-run`

To test the current checkout as if it were installed by a user:

```bash
pnpm cli:install-local
```

This packs the current repository and installs that tarball globally. Remove it with:

```bash
pnpm cli:uninstall-local
```

For day-to-day development inside the repository, use:

```bash
pnpm dev -- --help
```

## GitHub Actions

The repository uses two workflows with different responsibilities.

### PR Check

`project/.github/workflows/pr-check.yml` validates changes before or around merge:

- `Code Quality` runs `pnpm verify`
- `Package Readiness` runs tests, build, packed-install smoke test, and publish dry-run

This workflow owns validation.

### Release

`project/.github/workflows/release.yml` owns publication only.

It is triggered manually with `workflow_dispatch` and is expected to run on `main`.

The release workflow:

1. verifies that the workflow is running from `main`
2. reads `version` from `package.json`
3. fails if `spinedigest@<version>` already exists on npm
4. fails if tag `v<version>` already exists locally or on `origin`
5. runs `npm publish --access public`
6. creates and pushes tag `v<version>` after publish succeeds

The workflow intentionally does not rerun the full PR validation matrix.

## Release Checklist

1. Update `package.json` to the target version.
2. Merge the release commit to `main` through the normal PR flow.
3. Confirm `pr-check.yml` passed on the exact `main` commit you plan to publish.
4. Confirm the repository secret `NPM_TOKEN` is valid.
5. Run the `Release` workflow from `main`.
6. Confirm the npm package is live and the workflow pushed `v<version>`.

## Secrets

The release workflow currently uses one repository secret:

- `NPM_TOKEN`: npm access token with permission to publish `spinedigest`

Do not assume a maintainer's local npm login is enough for CI. The workflow only sees GitHub secrets.

## Maintenance Notes

- `prepack` builds the package before publish and before `npm pack`.
- `prepublishOnly` is intentionally not used. PR validation owns lint, tests, and dry-run checks.
- If you change the published file list or the wrapper layout, rerun `pnpm release:check` and inspect the tarball contents in the dry-run output.
- If you change Node support, update both `package.json` and the workflow Node versions together.
