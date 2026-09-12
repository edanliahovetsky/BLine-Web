# Scripts

Build, QA, release, and fixture-generation scripts live here.

## Offline release assets

Production web builds publish the current release. No previous deployment bundle
is needed; offline copies live in the browser. Once an update is completely
downloaded, each tab reloads after its saves finish and editing stops. Failed
saves and open dialogs defer the reload. Browser caches retain files needed by
those waiting tabs and discard unused releases as tabs update.

The files under `public/assets/fields/` are frozen legacy URL aliases. Update
built-in field artwork in `src/assets/fields/`; the browser mapping uses Vite's
hashed URLs while the core model keeps its logical field identifiers.
