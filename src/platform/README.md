# Platform

Shell detection, capability resolution, and high-level project IO services live
here. UI code should consume `projectIo` capabilities/actions instead of
branching directly on browser, Tauri, or shell-specific storage details.

Project-level import/export should go through the service as either the expanded
BLine autos folder (`config.json`, `paths/*.json`, and editor state under
`.bline-web/`) or the secondary project archive format. Single path and config
import/export stay BLine-Lib compatible at the file boundary.
