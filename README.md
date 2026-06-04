# MetaNode OS

## Description

MetaNode OS is a protected desktop launcher for running local AI automation systems with controlled access, signed runtime delivery, and local Docker execution.

It is built for environments where users need a simple desktop entry point, while release access, approval state, and long-lived infrastructure credentials remain managed outside the installed app. Approved devices can start the runtime locally after access is verified and downloaded assets pass integrity checks.

## Features

- **Desktop launcher**: a clean Windows and Linux app for starting and stopping the local MetaNode OS runtime.
- **Access-gated startup**: verifies user, device, and server-derived network identity before enabling runtime access.
- **Signed runtime delivery**: downloads protected release assets only after approval and verifies them before execution.
- **Integrity checks**: validates release signatures and SHA-256 hashes before loading Docker images.
- **Server-side distribution proxy**: keeps access tokens on trusted infrastructure instead of embedding them in the launcher.
- **Local Docker execution**: runs the application services locally through Docker Compose.
- **Optional local AI runtime**: detects native or Docker-based Ollama when available without making it mandatory.
- **Installer automation**: builds Windows and Linux installers through GitHub Actions and publishes release artifacts.
- **Separated control layers**: keeps launcher, access gate, distribution service, and local runtime responsibilities clearly isolated.

## Security Notes

MetaNode OS uses a controlled delivery model. The launcher can be distributed openly while approval secrets, signing keys, and service credentials stay on trusted infrastructure.

- The launcher embeds only public verification material.
- Signing keys stay in the protected release pipeline.
- Service access tokens stay server-side in the distribution service.
- Cloudflare Worker secrets stay in Worker secret storage.
- Public workflows must not contain raw secrets.
- Client-provided network identity is not trusted.
- Access approval is scoped to user identity, device identity, and server-derived IP.
- Runtime grants and download tokens are short-lived.
- Distribution requests require Worker-issued authorization.
- Runtime assets are verified before startup.
- Failed signature or hash verification stops execution.
- Downloaded bundles, Docker image archives, and environment files must remain excluded from git.
- The design provides controlled distribution and tamper resistance, not absolute protection against a fully controlled endpoint.
