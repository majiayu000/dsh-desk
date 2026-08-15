<p align="center">
  <img src="assets/dsh-desk-logo-anime-v1.png" width="132" alt="DSH Desk whale icon">
</p>

<h1 align="center">DSH Desk</h1>

<p align="center"><strong>DeepSeek Harness in 60 seconds. No Node.js. No terminal. No runtime roulette.</strong></p>

<p align="center">An installable desktop distribution that keeps the official Harness UI, pins the runtime, and checks upstream compatibility every day.</p>

<p align="center">
  <a href="https://github.com/majiayu000/dsh-desk/releases"><strong>Download preview</strong></a> ·
  <a href="https://majiayu000.github.io/dsh-desk/">Compatibility radar</a> ·
  <a href="docs/compatibility.md">Verification evidence</a> ·
  <a href="README.zh-CN.md">中文</a>
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

> A clean-machine, start-to-first-task video is the next launch gate. Until that measurement is published, “60 seconds” is a product target rather than a benchmark claim.

## Why this distribution exists

DeepSeek Harness already provides the agent runtime, web UI, sessions, tools, approvals, settings, and plugin protocol. DSH Desk does not fork those product surfaces. It owns the desktop responsibilities that should be boring and dependable:

- bundles Node 24 and the exact `@deepseek-ai/dsh@0.1.0-rc.6` runtime;
- isolates state in a private `DSH_HOME` instead of modifying an existing CLI setup;
- waits for a real HTTP health check on a random loopback port;
- grants the remote Harness page no Tauri IPC, shell, or filesystem capability;
- constrains navigation to the exact runtime origin and opens external links in the system browser;
- supervises only the process group it started;
- checks the pinned version and the newest upstream candidate every day;
- reviews plugin source, integrity, lifecycle scripts, and rollback boundaries before installation.

## Current availability

| Platform | Public status | Signing status |
|---|---|---|
| macOS Apple Silicon | `v0.1.0-alpha.1` preview | Ad-hoc signed; not notarized |
| Windows x64 | CI/update preview available | Production Authenticode release gate configured |
| Linux x64 | CI/update preview available | Updater signature gate configured |

The Windows and Linux preview artifacts exercise packaging and updates, but they are not presented as production-signed releases. Production release workflows fail closed when required credentials are absent. See the live [compatibility radar](https://majiayu000.github.io/dsh-desk/), [compatibility evidence](docs/compatibility.md), and individual [Actions runs](https://github.com/majiayu000/dsh-desk/actions) for the latest facts.

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

Catalog failure never falls back to an unreviewed global search. Plugin authors can use the [minimal template](templates/dsh-plugin/README.md) and submit the [compatibility verification form](.github/ISSUE_TEMPLATE/plugin-validation.yml).

## Compatibility is a release artifact

Every push and pull request tests macOS arm64, Windows x64, and Linux x64 for:

- TypeScript build and Rust checks/tests;
- real Harness startup, strict loopback URL, and HTTP readiness;
- an offline runtime that does not depend on system Node.js;
- plugin add/why/update/remove parity with the original CLI;
- onboarding and signed-updater contracts.

A scheduled workflow also installs the newest npm candidate in an isolated CI workspace. It reports drift without silently changing the runtime on user machines. Read the [public matrix](docs/compatibility.md) for evidence and precise definitions.

## Development

The development toolchain uses pnpm 11.7.0:

```sh
npx --yes pnpm@11.7.0 install
npx --yes pnpm@11.7.0 exec tauri dev
```

Run the complete local verification suite:

```sh
pnpm check
pnpm test:rust
pnpm test:harness-contract
pnpm test:onboarding-contract
pnpm prepare:runtime       # requires Node 24
pnpm test:packaged-runtime
pnpm test:plugin-parity
pnpm test:plugin-template
pnpm test:plugin-catalog
pnpm test:updater-contract
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
- [Product metrics and privacy gates](docs/product-metrics.md)
- [30-day execution plan](docs/30-day-plan.md)
- [Launch kit](docs/launch-kit.md)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

## License

DSH Desk's own code is available under the [MIT License](LICENSE). DeepSeek Harness and other dependencies remain under their respective licenses.
