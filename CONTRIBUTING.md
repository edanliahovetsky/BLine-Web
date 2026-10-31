# Contributing

## Branches and releases

BLine Web 1.0 made the 2027 editor the stable release. Every change is tested
in a beta before it becomes stable:

| Branch       | Purpose                       | Publishing                                                               |
| ------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `bline-2027` | Development                   | Does not deploy the editor                                               |
| `web-beta`   | Beta candidate for testers    | [beta.bline.run](https://beta.bline.run/) and draft prerelease downloads |
| `main`       | Stable: what bline.run serves | Does not deploy the editor                                               |
| `web-deploy` | Stable release                | [bline.run](https://bline.run/) and draft release downloads              |

1. Start every change, fixes included, from `bline-2027`. Keep short-lived
   working branches local unless a remote branch is needed for an agreed
   contribution.
2. Promote a tested `bline-2027` commit to `web-beta` for testers.
3. When that beta holds up, bring the same changes into `main` and promote
   `main` to `web-deploy` as the stable release.

`main` only receives changes that have been through a beta, never routine
development or housekeeping. After each stable release, merge `main` into
`bline-2027` so development continues from what bline.run serves.

Promote an exact tested candidate to its publishing branch only when a release
is intended. A push to `web-deploy` or `web-beta` updates the corresponding
Cloudflare site. GitHub prepares draft downloads after its validation and
artifact jobs pass; publishing that draft is a separate action. Do not use a
publishing branch for routine development or documentation edits.

Cloudflare's production branch stays `web-deploy`; its preview branch is
`web-beta`, served at `beta.bline.run`. Keep the beta URL unchanged across
releases so testers retain their browser projects. Builds from `web-beta` use
the beta channel, which requires a prerelease version such as `1.1.0-beta.1`.
See the [beta release guide](docs/beta-releases.md) for build flags and preview
settings.

The retired `bline-web.pages.dev` and `web-beta.bline-web.pages.dev` addresses
still serve these branches and move visitors' browser projects to bline.run
(see [`service/README.md`](service/README.md)). Keep that handoff in both
release lines while those addresses still receive visitors.

Use a new version and tag for each changed release candidate. Preserve existing
release tags and downloads. Follow the [release model](README.md#release-model)
for validation and version metadata.

## Local checkouts

Use separate worktrees when working on stable and preview concurrently. For
example, from a clone with `main` checked out:

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
