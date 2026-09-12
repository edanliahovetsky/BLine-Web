# Scripts

Build, QA, release, and fixture-generation scripts live here.

## Offline release assets

Production web builds publish the current release. No previous deployment bundle
is needed; offline copies live in the browser.

The files under `public/assets/fields/` are frozen legacy URL aliases. Update
built-in field artwork in `src/assets/fields/`; the browser mapping uses Vite's
hashed URLs while the core model keeps its logical field identifiers.
