# BLine Web beta releases

The 2027 preview uses the release title **BLine Web 2027 Beta 2**, version
`1.0.0-beta.2`, and Git tag `v1.0.0-beta.2`. Later previews increment the beta
number. The finished release will be `v1.0.0`.

## Branches and website

- `web-editor-improvements` contains the new editor development.
- `web-beta` holds the specific candidate offered to beta testers.
- `web-deploy` continues to serve the current public editor.

Promote a reviewed candidate to `web-beta` when it is ready for testers.
Cloudflare deploys that push, and GitHub builds a **draft prerelease** with web,
Windows, macOS, and Linux downloads. Publishing the GitHub draft is a separate
step. Release tags are immutable: use a new beta number for a changed candidate.

Configure the existing Cloudflare Pages project `bline-web` as follows:

| Setting                                          | Value                           |
| ------------------------------------------------ | ------------------------------- |
| Production branch                                | `web-deploy`                    |
| Preview branches                                 | Custom: include `web-beta` only |
| Build command                                    | `npm run build`                 |
| Output directory                                 | `dist`                          |
| Node version                                     | `24.6.0`                        |
| Preview environment: `VITE_RELEASE_CHANNEL`      | `beta`                          |
| Preview environment: `VITE_ENABLE_BUG_REPORT`    | `true`                          |
| Production environment: `VITE_RELEASE_CHANNEL`   | `stable` or unset               |
| Production environment: `VITE_ENABLE_BUG_REPORT` | `false` or unset                |

Preserve other existing project settings. In particular, do not switch the
production branch to `web-beta` or put the beta flags in production variables.
The persistent tester URL is <https://web-beta.bline-web.pages.dev/>. Keep using
that URL across beta updates so the browser retains its workspace and offline
copy. Individual deployment URLs have separate browser storage.

This is an opt-in public beta, available to people given the link; the branch
alias and GitHub prerelease do not require an invitation. Use Cloudflare Access
separately if access must be restricted to named testers.

## Desktop identity and storage

The beta installs as **BLine Web Beta**, with application identifier
`org.bline.web.beta` and binary `bline-web-beta`. The current app keeps
`org.bline.web`. The beta uses its own settings, recent-folder history, and
webview data; installing it does not import the current app's workspace.
Keep the beta identifier and Windows UpgradeCode fixed for later beta builds.

User-selected project folders are ordinary files. If both desktop apps open the
same folder, both edit those files. Test existing projects on a copy. Browser
projects can move between the current website and beta through project archive
export/import.

Windows MSI compares only three version fields. For beta builds the installer
version is `major.minor.(patch * 1000 + beta number)`: Beta 1 is `1.0.1`, Beta 2
is `1.0.2`. The release version remains `1.0.0-beta.2`. Beta numbers are limited
to 1–999 and the combined third field must fit within 65535. The current
release channel retains its existing installer version mapping.

## Build a candidate

Keep versions aligned in `package.json`, `package-lock.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.

```sh
npm ci
npm run release:validate -- beta
```

The beta commands set branding and bug reporting and apply the desktop identity
overlay. The desktop build also preserves all window settings from the base
configuration. Ordinary `build` and `tauri:build` commands keep the current app
identity, unless web branding flags are explicitly supplied.

Run the full local gate before pushing the exact candidate. It checks metadata,
formatting, lint, types, units and optimizer corpus, parity and BLine-Lib IO,
the full browser suite, beta-specific toolbar behavior, production offline
recovery, Rust checks, and the local desktop build. Set `BLINE_LIB_DIR` when the
library checkout is not in its usual sibling location. A failed check stops the
gate; it never pushes or publishes.

On GitHub, CI runs the full browser suite once. The beta-only pass repeats only
layouts and keyboard navigation affected by the extra bug-report control;
general startup and storage tests remain in the full suite. Browser tests advance
the test clock for deliberate delays and wait for generation/import completion.
The test runner applies a guarded Playwright 1.59.1 workaround that registers the
directory-upload input listener before sending files to WebKit; review it when
upgrading Playwright. The application import handler and native file upload still
run normally. Release artifact
jobs start in parallel with CI validation, without waiting for the browser suite.

The draft release depends on successful app validation, Windows storage tests,
and every installer/web build in that same CI run. Reusable workflows inherit
its immutable commit SHA, and the publication job checks the candidate SHA again.
Assets come only from that run, so an older green run or artifacts from another
commit cannot satisfy the gate. Failed or canceled validation prevents tagging
and draft creation. Inspect the resulting artifacts before publishing the draft.

## Feedback

`VITE_ENABLE_BUG_REPORT=true` adds the bug icon immediately to the right of the
path selector. The default is off. The link opens a GitHub issue draft with the
release title, version, app type, and browser/system user agent. It includes no
project contents or local paths. Testers supply the problem, reproduction steps,
and optional attachments, then submit the issue themselves.

The browser opens a new tab; desktop uses the system browser. If the desktop
browser cannot open, the editor provides a link to copy manually. GitHub sign-in
and an internet connection are needed to submit a report.

## Downloads and release notes

Generate the beta draft notes with `BLINE_RELEASE_CHANNEL=beta npm run
release:notes` (or let the workflow generate them). Review their user-facing copy
alongside the recorded validation before publication.

Share version-pinned links for the beta, such as
`/d/web/v1.0.0-beta.2/windows-x64` on the BLine Metrics Worker. Do not use the
moving `prerelease` or `latest` redirects to distinguish the current editor from
the beta: those select the newest matching published release, including betas.

Before publishing the first beta, update current-editor download links in the
public installation docs and README to the current editor's exact tag
(`v0.1.0-alpha.12` at beta preparation). The `stable` redirect excludes all
prereleases and is not a substitute for the current alpha editor. No Metrics
Worker behavior change is required if the public entry points are pinned.

The GitHub draft is held for review, but a `web-beta` push makes the website
public immediately. Finish candidate review before the first push. After the
recorded user stories have been reviewed, carry any fixes into one candidate,
check its beta branding and packaging, then promote that exact commit.
