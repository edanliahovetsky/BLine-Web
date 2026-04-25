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
