# Scripts

Build, QA, release, and fixture-generation scripts live here.

## Offline release assets

For production web builds, set `BLINE_PREVIOUS_WEB_DIST` to the extracted,
previously served web bundle. `npm run build` carries its immutable asset files
and HTML snapshots into the new output **after** generating the new precache.
Carry forward the accumulated bundle each time to retain earlier releases too.
The entry page, service worker, and new release's manifest are never replaced.
Different bytes at an existing immutable URL fail the build.

The hosting/build pipeline must supply this previous bundle; ordinary clean
builds cannot recover files from prior deployments. Retention matters for an
online tab whose optional resources were not cached before the next deployment.
Browser caches retain complete releases and files needed by open editors, but
cannot substitute for server retention of resources never downloaded.

The files under `public/assets/fields/` are frozen legacy URL aliases. Update
built-in field artwork in `src/assets/fields/`; the browser mapping uses Vite's
hashed URLs while the core model keeps its logical field identifiers.
