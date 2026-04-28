# Parity Harness

Phase 2 parity checks live in `parity.test.ts` and run through:

```sh
npm run parity
```

The harness is intentionally fixture-backed and narrow:

- legacy project/schema round-trip stability
- native path serializer ranged-constraint ordinal stability
- deterministic simulation output for the dense PySide reference fixture

This does not replace the unit suite or Playwright suite. It is the explicit
cross-cutting parity gate for behavior that must stay aligned with the existing
PySide6 editor during Phase 2.

## BLine-Lib IO Compatibility

The BLine-Lib compatibility gate is intentionally separate from `npm run parity`
because it needs a BLine-Lib checkout and runs Gradle:

```sh
npm run validate:bline-lib-io
```

By default, local runs use `/Users/edan/FRC/BLine-Lib`. Override that with:

```sh
BLINE_LIB_DIR=/path/to/BLine-Lib npm run validate:bline-lib-io
```

CI checks out `edanliahovetsky/BLine-Lib@main` into `.ci/BLine-Lib` and sets
`BLINE_LIB_DIR` so the gate validates against current BLine-Lib development
head instead of a machine-specific sibling path.
