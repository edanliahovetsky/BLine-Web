# Contributing

## Branches and releases

Keep stable and 2027 beta development separate:

| Branch       | Purpose               | Publishing                                                                          |
| ------------ | --------------------- | ----------------------------------------------------------------------------------- |
| `main`       | Stable development    | Does not deploy the editor                                                          |
| `web-deploy` | Tested stable release | [Stable editor](https://bline-web.pages.dev/) and draft release downloads           |
| `bline-2027` | 2027 beta development | Does not deploy the editor                                                          |
| `web-beta`   | Tested beta release   | [Beta editor](https://web-beta.bline-web.pages.dev/) and draft prerelease downloads |

Start changes from the development branch for the intended release line. Keep
short-lived working branches local unless a remote branch is needed for an
agreed contribution. Do not merge the beta into stable as part of housekeeping.

Promote an exact tested candidate to its publishing branch only when a release
is intended. A push to `web-deploy` or `web-beta` updates the corresponding
Cloudflare site. GitHub prepares draft downloads after its validation and
artifact jobs pass; publishing that draft is a separate action. Do not use a
publishing branch for routine development or documentation edits.

Cloudflare's production branch stays `web-deploy`; its preview branch is
`web-beta`. Keep the beta URL unchanged across releases so testers retain their
browser projects. See the beta branch's
[release guide](https://github.com/edanliahovetsky/BLine-Web/blob/bline-2027/docs/beta-releases.md)
for build flags and preview settings.

Use a new version and tag for each changed release candidate. Preserve existing
release tags and downloads. Follow the [release model](README.md#release-model)
for validation and version metadata.

## Local checkouts

Use separate worktrees when working on stable and beta concurrently. For example,
from a clone with `main` checked out:

```sh
git fetch origin
git worktree add --track -b bline-2027 ../BLine-Web-2027 origin/bline-2027
```

If that local branch already exists, use `git worktree add ../BLine-Web-2027
bline-2027` instead. Do not use a temporary directory for work that must survive
a system cleanup.

Before deleting a working branch, verify that its commits are contained in a
retained branch or preserve them in a verified local backup. Keep uncommitted
files and unpublished experiments. Prune registrations for missing worktrees;
do not remove an active checkout just to shorten the branch list. Push named
development branches explicitly so local experiments and archives stay local.
