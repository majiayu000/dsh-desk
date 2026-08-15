# Plugin compatibility verification

DSH Desk uses two deliberately different signals. A self-service candidate check proves that a plugin completes a fixed CLI lifecycle. A verified badge additionally requires maintainer review against the packaged DSH Desk runtime and the plugin trust fields.

Neither signal is a security guarantee.

## 1. Add the candidate check

Create `.github/workflows/dsh-desk-plugin.yml` in the plugin repository:

```yaml
name: DSH Desk plugin compatibility

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: majiayu000/dsh-desk/plugin-verification@main
        with:
          plugin-path: .
          harness-version: 0.1.0-rc.6
```

Pin the action to a commit SHA before relying on it as a release gate. `@main` is shown only while DSH Desk has no stable action tag.

The action uses Node 24, creates a temporary `DSH_HOME`, rejects lifecycle scripts from the self-service path, and exercises:

- `plugin add` from the checked-out source;
- composed Web Profile configuration;
- `plugin why`;
- `plugin update`;
- `plugin remove`.

On success, a plugin may display the candidate badge:

```markdown
[![DSH Desk candidate](https://img.shields.io/badge/DSH_Desk-candidate-f0a65a)](https://github.com/majiayu000/dsh-desk/blob/main/docs/plugin-verification.md)
```

[![DSH Desk candidate](https://img.shields.io/badge/DSH_Desk-candidate-f0a65a)](https://github.com/majiayu000/dsh-desk/blob/main/docs/plugin-verification.md)

The word **candidate** must remain visible. Passing this action does not authorize a “verified”, “safe”, or “official” claim.

## 2. Request packaged-runtime verification

Open a [plugin verification request](https://github.com/majiayu000/dsh-desk/issues/new?template=plugin-validation.yml) with:

- exact package name, version, source, and repository;
- file, network, command, and credential requirements;
- every lifecycle script and why it is necessary;
- supported platforms and exact Harness version;
- a link to the passing candidate workflow.

A maintainer then checks the same lifecycle against the packaged runtime, inspects the published package metadata and integrity, records known limitations, and adds an exact catalog entry. Verification is version-specific and can be withdrawn after a regression or ownership change.

Only a catalog entry with public evidence may use:

```markdown
[![Verified with DSH Desk](https://img.shields.io/badge/DSH_Desk-verified-36c9a5)](CATALOG_EVIDENCE_URL)
```

## Badge rules

| Label | Who can use it | Meaning |
|---|---|---|
| Candidate | Any plugin with a passing reusable action | Fixed Harness CLI lifecycle passed |
| Verified | Exact version listed in the DSH Desk catalog | Packaged runtime and trust metadata reviewed |
| Bundled | Upstream capability distributed with the pinned Harness | Not a third-party endorsement |

Badges never mean vulnerability-free, officially endorsed by DeepSeek, or authorized to access user data. Plugin READMEs must still disclose their own permissions and data flows.
