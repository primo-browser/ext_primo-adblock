# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Primo-branded fork of [gorhill/uBlock](https://github.com/gorhill/uBlock). Upstream master is merged into the `primo` branch, where Primo-specific additions live (build/packaging scripts, manifest customizations, branding). When debugging or extending behavior, treat the upstream README/wiki as the canonical reference for uBlock Origin (MV2) and uBlock Origin Lite / "uBOL" (MV3) — this fork mostly re-skins MV3 as **Primo AdBlock** and changes how it gets packaged and shipped.

## Two extensions live here

This is **not** one extension. The repo produces multiple browser extensions sharing source:

- **uBlock Origin (MV2)** — `platform/chromium/manifest.json`, `platform/firefox/`, etc. Background page (`background.html`), full webRequest blocking. Built into `dist/build/uBlock0.<platform>/`.
- **uBlock Origin Lite / "uBOL" (MV3)** — `platform/mv3/<platform>/manifest.json` + `platform/mv3/extension/`. Service worker, declarativeNetRequest. Built into `dist/build/uBOLite.<platform>/`. **This is the one Primo ships as "Primo AdBlock".**

The MV3 build pulls some shared code (parsers, scriptlets, resources) from `src/` and combines it with `platform/mv3/extension/` — see `tools/make-mv3.sh` for exactly which files cross over. The two builds are otherwise independent codebases despite sharing this tree.

## Primo-specific bits

What's added on top of upstream (everything else is uBO):

- **`buildall.sh`** — orchestrates a Primo MV3 build: `make-clean.sh` → `pull-assets.sh` → `make-chromium.sh` (MV2) → `make-mv3.sh` (MV3). Flags: `--clean`, `--mv2`, no flag = both.
- **`build.mjs`** — zx-based packager. Reads `version_name` from the built MV3 manifest, runs `buildall.sh`, copies the MV3 build out, zips it, packs a `.crx` using Chrome's `--pack-extension` (requires `/Applications/PrimoBrowser.app` and `primo_adblock.pem`), then commits/pushes to `primo-browser/primo-extensions` on GitHub and regenerates that repo's `README.md` from `changelog.json` (interactive — opens the file in WebStorm/VSCode and waits for Enter). Run with `zx build.mjs`.
- **`platform/mv3/chromium/manifest.json`** — rebranded as "Primo AdBlock", uses Primo's extension `key`, `update_url` points to `storage.googleapis.com/primobrowser-extensions/updates.xml`. The `version_name` field is the Primo-controlled version (separate from upstream's `version`) — `46efd71a2` exists specifically to keep these decoupled. **When bumping Primo's release, edit `version_name`, not `version`.**
- **`primo_adblock.pem`** — extension signing key. Gitignored (`*.pem`). Required by `build.mjs` for CRX packing.

## Common commands

- `git submodule update --init` — required before first build (`platform/mv3/extension/lib/codemirror/codemirror-ubol`, `publish-extension`).
- `npm install` — Node ≥22, npm ≥11 (`.nvmrc` = `lts/jod`).
- `npm run lint` — ESLint over `src/js/`, `platform/**/*.js`, and JSON. **There is no test suite** (`npm test` is a stub).
- `bash buildall.sh` — full Primo build (MV2 + MV3 Chromium). Use `--mv2` for MV2 only, `--clean` to wipe `dist/build/`.
- `zx build.mjs` — Primo release packager (zip + CRX + GitHub upload). Reads version from MV3 manifest's `version_name`.
- `make chromium` / `make firefox` / `make mv3-chromium` / `make mv3-firefox` / `make mv3-edge` / `make mv3-safari` — individual upstream targets. See `Makefile` for the full list including `publish-*` (used by upstream, not Primo).
- `make cleanassets` — drop cached filter lists in `dist/build/uAssets` and `dist/build/mv3-data` to force a fresh fetch on next build.

Build outputs land in `dist/build/`. Primo release zips/CRX land in `compiled/v<version>/`. Both directories are gitignored.

## Loading a build for manual testing

- **MV2 (Chromium)**: `chrome://extensions` → Developer mode → Load unpacked → `dist/build/uBlock0.chromium/`.
- **MV3 (Chromium / Primo)**: same flow, point at `dist/build/uBOLite.chromium/`. `tools/make-mv3.sh` adds the `declarativeNetRequestFeedback` permission for unpacked dev builds — production zips built with an explicit version tag won't have it.

## Code layout, briefly

- `src/` — shared MV2 source (HTML pages, `js/`, CSS, locales, web-accessible resources). Top-level HTML files are dashboard panes (`dashboard.html`, `1p-filters.html`, `dyna-rules.html`, etc.).
- `platform/<browser>/` — per-browser MV2 manifest + thin shims (`vapi-*.js` is the abstraction layer over `browser.*`/`chrome.*` APIs).
- `platform/mv3/extension/` — MV3-specific source (own `js/`, own HTML pages like `popup.html`, `dashboard.html`, `picker-ui.html`). This is a parallel codebase, not a subset of `src/`.
- `platform/mv3/<browser>/manifest.json` — per-browser MV3 manifests (chromium/firefox/edge/safari). Edge/Safari have additional patch scripts run by `make-mv3.sh`.
- `platform/mv3/scriptlets/` + `make-rulesets.js` — MV3 ruleset compiler. Filter lists get converted into declarativeNetRequest JSON rules at build time, plus scriptlet bundles for what DNR can't express.
- `tools/make-*.sh` — per-target build orchestration. `make-mv3.sh` is the most complex (assembles files from both `src/` and `platform/mv3/`, runs the ruleset compiler, applies platform-specific patches).
- `assets/` — bundled filter lists checked in for offline / first-run.
- `dist/` — both source dist files (`description/`, `firefox/updates.json`) and build outputs (`build/`, gitignored).
