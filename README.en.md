<p align="center">
  <img src="assets/dsh-desk-logo-anime-v1.png" width="132" alt="DSH Desk whale icon">
</p>

<h1 align="center">DSH Desk</h1>

<p align="center"><strong>Installable DeepSeek Harness for your desktop. No separate Node.js setup. No terminal.</strong></p>

<p align="center">An installable desktop distribution that keeps the official Harness UI, pins the runtime, and checks upstream compatibility every day.</p>

<p align="center">
  <a href="https://github.com/majiayu000/dsh-desk/releases"><strong>Download preview</strong></a> ·
  <a href="https://www.dshdesk.com/">Compatibility radar</a> ·
  <a href="docs/compatibility.md">Verification evidence</a> ·
  <a href="README.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml"><img alt="Upstream compatibility" src="https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4c6ef5.svg"></a>
</p>

> [!IMPORTANT]
> DSH Desk is a community project. It is not an official DeepSeek product and is not affiliated with or endorsed by DeepSeek. DeepSeek Harness and related names, trademarks, and code belong to their respective owners.

## From download to first task

1. Download the build for your platform from [Releases](https://github.com/majiayu000/dsh-desk/releases).
2. Install and open DSH Desk. The pinned Harness runtime starts automatically.
3. Choose a model provider in the official Harness onboarding dialog and send your first task.

No system Node.js installation, npm setup, port selection, or terminal command is required.

> 📺 Video slot: a clean-machine, uncut download-to-first-task recording is the next launch gate and will be embedded here once published. Until then, “60 seconds” is a product target rather than a benchmark claim.

## Why this distribution exists

DeepSeek Harness already provides the agent runtime, web UI, sessions, tools, approvals, settings, and plugin protocol. DSH Desk does not fork those product surfaces. It owns the desktop responsibilities that should be boring and dependable:

- bundles Node 24 and the exact Harness runtime listed below;
- isolates state in a private `DSH_HOME` instead of modifying an existing CLI setup;
- waits for a real HTTP health check on the launch-token loopback URL;
- grants the remote Harness page no Tauri IPC, shell, or filesystem capability;
- constrains navigation to the exact runtime origin and opens external links in the system browser;
- supervises only the process group it started;
- checks the pinned version and the newest upstream candidate every day;
- reviews plugin source, integrity, lifecycle scripts, and rollback boundaries before installation.

## Current availability

<!-- release-evidence:start -->
Recorded public release: [`v0.1.0-alpha.14`](https://github.com/majiayu000/dsh-desk/releases/tag/v0.1.0-alpha.14), published 2026-09-28T18:09:55Z.

| Platform | Recorded download assets | Signing evidence |
|---|---|---|
| macOS Apple Silicon | [DMG](https://github.com/majiayu000/dsh-desk/releases/download/v0.1.0-alpha.14/DSH.Desk_0.1.0-alpha.14_aarch64.dmg) | Release CI passed Developer ID / notarization / staple checks |
| macOS Intel | [DMG](https://github.com/majiayu000/dsh-desk/releases/download/v0.1.0-alpha.14/DSH.Desk_0.1.0-alpha.14_x64.dmg) | Release CI passed Developer ID / notarization / staple checks |
| Windows x64 | [NSIS](https://github.com/majiayu000/dsh-desk/releases/download/v0.1.0-alpha.14/DSH.Desk_0.1.0-alpha.14_x64-setup.exe) | Unsigned alpha (SmartScreen notice); Updater verification passed release CI |
| Linux x64 | [AppImage](https://github.com/majiayu000/dsh-desk/releases/download/v0.1.0-alpha.14/DSH.Desk_0.1.0-alpha.14_amd64.AppImage) / [deb](https://github.com/majiayu000/dsh-desk/releases/download/v0.1.0-alpha.14/DSH.Desk_0.1.0-alpha.14_amd64.deb) | Updater verification passed release CI |

The release's [package.json](https://github.com/majiayu000/dsh-desk/blob/e45152db0c25da44c6c59951ce65fd1d0c40ef4e/package.json) pins DSH Desk `0.1.0-alpha.14` with Harness `0.1.5-rc.3`. [Release run](https://github.com/majiayu000/dsh-desk/actions/runs/36458490294): `completed/success`.

Evidence observed 2026-10-06T14:06:00Z. This table checks saved public metadata; it is not an independent download/signature verification or a guarantee of continued availability. Updater signing does not establish Windows Authenticode identity.
<!-- release-evidence:end -->

<!-- build-versions:start -->
Repository development version: DSH Desk `0.1.0-alpha.14` × Harness `0.1.5-rc.3` (from current `package.json`; published downloads follow the release evidence).
<!-- build-versions:end -->

## What is different

| | Official Harness CLI | Typical desktop wrapper | DSH Desk |
|---|---|---|---|
| Runtime setup | User manages Node/npm | Varies; may resolve `latest` | Exact bundled runtime |
| Official UI | Yes | Sometimes modified | Unmodified |
| Desktop IPC from runtime page | Browser-only | Project-dependent | None |
| Upstream drift detection | User-managed | Project-dependent | Daily public checks |
| Failed update recovery | User-managed | Project-dependent | Signed updater contract and explicit recovery path |

DSH Desk does **not** claim to have the smallest installer. The offline runtime increases package size. “Lightweight” here means no bundled Chromium and no fork of the official product UI.

## Trusted plugin workflow

Open `DSH Desk → Plugins…` to inspect a plugin before installation:

- exact package, resolved version, source, and integrity;
- lifecycle scripts and declared file/network/command/credential needs;
- compatibility with the pinned Desktop and Harness versions;
- disable, removal, and profile restoration boundaries.

Catalog failure never falls back to an unreviewed global search. The Plugins window can open the community registry at [plugin.dshdesk.com](https://plugin.dshdesk.com/); copied `dsh plugin add` commands are parsed into the same review flow, and that site is not the trusted catalog. Plugin authors can use the [minimal template](templates/dsh-plugin/README.md), run the reusable [candidate compatibility check](docs/plugin-verification.md), and submit the verification form only after it passes.

## Compatibility is a release artifact

Every push and pull request tests macOS arm64, Windows x64, and Linux x64 for:

- TypeScript build and Rust checks/tests;
- real Harness startup, strict loopback URL, and HTTP readiness;
- an offline runtime that does not depend on system Node.js;
- plugin add/why/update/remove parity with the original CLI;
- onboarding and signed-updater contracts.

A scheduled workflow also installs the newest npm candidate in an isolated CI workspace. It reports drift without silently changing the runtime on user machines. Read the [public matrix](docs/compatibility.md) for evidence and precise definitions.

## Development

The development toolchain uses pnpm 12.3.4:

```sh
npx --yes pnpm@12.3.4 install --frozen-lockfile
npx --yes pnpm@12.3.4 exec tauri dev
```

Run local verification with Node 24, following the [CI workflow](.github/workflows/ci.yml). Linux AppImage packaging and verification as a different user run in Linux CI:

```sh
pnpm test:doc-links
pnpm test:status-page
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
pnpm check
pnpm test:rust
pnpm test:updater-contract
pnpm test:cross-device
pnpm test:harness-contract
pnpm test:onboarding-contract
pnpm prepare:runtime
pnpm test:packaged-runtime
pnpm test:plugin-parity
pnpm test:plugin-review
pnpm test:plugin-template
pnpm test:plugin-source
pnpm test:plugin-catalog
```

Set an initial workspace with `DSH_DESKTOP_WORKSPACE=/path/to/project`. Create a minimal plugin bundle with:

```sh
pnpm create:plugin ./my-dsh-plugin @your-scope/my-dsh-plugin
```

## Project documents

- [Desktop architecture and security boundary](docs/desktop-architecture.md)
- [Runtime distribution and rollback contract](docs/runtime-distribution.md)
- [Compatibility matrix](docs/compatibility.md)
- [Release signing gates](docs/release-signing.md)
- [Plugin trust model](docs/plugin-trust.md)
- [Plugin compatibility verification and badge rules](docs/plugin-verification.md)
- [Product metrics and privacy gates](docs/product-metrics.md)
- [30-day execution plan](docs/30-day-plan.md)
- [Launch kit](docs/launch-kit.md)
- [Launch posts 2026-08](docs/launch-posts-2026-08.md)
- [Ecosystem review v1](docs/ecosystem-review-v1.md)
- [Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md) · [Security policy](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

## License

DSH Desk's own code is available under the [MIT License](LICENSE). DeepSeek Harness and other dependencies remain under their respective licenses.
