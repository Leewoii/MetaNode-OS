# MetaNode OS

Public launcher and access-gate workspace for MetaNode OS.

This repository does **not** contain the private MetaNode OS core runtime. The core lives in a separate private repository and is released as signed Docker image bundles. Approved desktop launchers download those release assets through the gate/distribution flow.

## What Is In This Repo

- `apps/launcher`: Tauri desktop launcher for Windows and Linux.
- `apps/gate-worker`: Cloudflare Worker that handles user + IP + device approval.
- `apps/distribution-api`: Server-side proxy that streams private GitHub release assets without exposing GitHub tokens to the launcher.
- `docs`: Deployment and architecture notes for the private-core gate flow.

## What Is Not In This Repo

The private core source is not part of the public repo:

- `apps/api`
- `apps/web`
- `apps/worker`
- `packages/core`

Those files are staged locally in `metanode-os-core-private/`, which is ignored by this public repo. Initialize that folder as its own private GitHub repository.

## Runtime Flow

```text
Tauri Launcher
-> Cloudflare Worker approval
-> short-lived runtime grant
-> short-lived core download token
-> Distribution API
-> private GitHub release assets
-> signed Docker core bundle
-> local Docker runtime
```

The launcher does not clone or download the private repository. It downloads signed release artifacts only. GitHub credentials stay server-side in the distribution API.

## Security Notes

- Never commit `.env`, `.env.local`, generated secrets, Docker image tar files, or downloaded core bundles.
- The launcher embeds only public verification material.
- Cloudflare Worker derives IP server-side; client-provided IP is not trusted.
- Approved access is bound to user/license ID, IP address, and device ID.
- Private core release manifests are signed in private CI.
- Copied core images still need a valid short-lived runtime grant before startup.
- This is tamper resistance and access control, not unbreakable DRM.

## Build Commands

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test
cargo check --manifest-path apps/launcher/src-tauri/Cargo.toml
```

Build desktop installers:

```powershell
npm.cmd run build:launcher
```

## Deployed Gate

Current gate Worker:

```text
https://metanode-access-gate-frost.leeroi-c25.workers.dev
```
