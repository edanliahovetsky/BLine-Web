# Platform

Shell detection, capability resolution, and high-level project IO services live
here. UI code should consume `projectIo` capabilities/actions instead of
branching directly on browser, Tauri, or shell-specific storage details.

The auto-constraint worker runner and worker entry live here because Worker
lifecycle, browser scheduling, and main-thread fallback are platform concerns;
the optimizer itself remains framework-free under `core`.

Project-level import/export should go through the service as either the expanded
BLine autos folder (`config.json`, `paths/*.json`, and the narrow editor-owned
`project.json`) or the secondary project archive format. Field Backgrounds live
in global User Data. The `.bline-web` directory is a read-only legacy migration
source, not part of newly written Projects. Single path and config import/export
stay BLine-Lib compatible at the file boundary.
