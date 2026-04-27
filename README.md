# BLine Web

Implementation repo for the web-first BLine editor.

## Scripts

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run parity`
- `npm run test:e2e`
- `npm run build`
- `npm run release:check`
- `npm run tauri:dev`
- `npm run tauri:build`

## Release Model

`main` is the stable working branch. It should stay green, but it does not
deploy to Cloudflare and does not create desktop release artifacts.

`web-deploy` is the public release branch. Cloudflare Pages should be configured
to deploy production from `web-deploy` with:

- build command: `npm run build`
- output directory: `dist`
- Node version: `24.6.0`

Every push to `web-deploy` runs the release gate, builds the Vite web bundle,
builds unsigned Tauri desktop artifacts for testers, and creates or updates a
draft GitHub Release named from `package.json` such as `v0.1.0-alpha.1`.

Promotion is explicit: merge or push a tested commit to `web-deploy` when it is
ready for the public Cloudflare site and draft desktop release artifacts.
Cloudflare hosts the website; GitHub Releases host desktop installers.

Systemcore service/package work is intentionally placeholder-only until Phase 3.
