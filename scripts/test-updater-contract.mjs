import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertContract as assert, createContractReader } from "./lib/contract.mjs";

const root = resolve(import.meta.dirname, "..");
const read = createContractReader(root);

const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargoToml = read("src-tauri/Cargo.toml");
const cargoPackage = cargoToml.match(/\[package\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/)?.[1];
const cargoVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];

assert(cargoVersion === packageJson.version, "Cargo.toml version must match package.json");
assert(tauriConfig.version === packageJson.version, "tauri.conf.json version must match package.json");
assert(tauriConfig.bundle?.createUpdaterArtifacts === true, "Tauri updater artifacts must be enabled");

const updater = tauriConfig.plugins?.updater;
assert(updater, "Tauri updater configuration is missing");
assert(updater.endpoints?.length === 1, "The stable channel must have exactly one updater endpoint");
assert(
  updater.endpoints[0] === "https://github.com/majiayu000/dsh-desk/releases/latest/download/latest.json",
  "The stable updater endpoint must use the public GitHub latest release",
);
assert(updater.windows?.installMode === "passive", "Windows updates must use passive NSIS mode");

const updaterSource = read("src-tauri/src/updater.rs");
assert(
  updaterSource.includes(
    'show_info_nonblocking(&app, "正在检查更新", "另一个更新检查正在进行中。");',
  ),
  "A concurrent manual update check must not block the main event loop",
);
assert(
  updaterSource.includes(".show(|_| {});"),
  "The concurrent-check notice must use the non-blocking dialog API",
);

const decodedPublicKey = Buffer.from(updater.pubkey, "base64").toString("utf8");
const publicKeyLines = decodedPublicKey.trim().split(/\r?\n/);
assert(publicKeyLines.length === 2, "Updater public key must contain a comment and key payload");
assert(publicKeyLines[0].startsWith("untrusted comment:"), "Updater public key comment is malformed");
const publicKeyBytes = Buffer.from(publicKeyLines[1], "base64");
assert(publicKeyBytes.length === 42, "Updater public key payload must be 42 bytes");
assert(
  publicKeyBytes[0] === 0x45 && [0x44, 0x64].includes(publicKeyBytes[1]),
  "Updater public key uses an unsupported minisign algorithm",
);

const capabilityDir = resolve(root, "src-tauri/capabilities");
for (const name of readdirSync(capabilityDir).filter((name) => name.endsWith(".json"))) {
  const capability = JSON.parse(read(`src-tauri/capabilities/${name}`));
  const permissions = capability.permissions ?? [];
  assert(
    permissions.every((permission) => {
      const identifier = typeof permission === "string" ? permission : permission?.identifier;
      return typeof identifier !== "string" || !identifier.startsWith("updater:");
    }),
    `${name} must not expose updater commands to a WebView`,
  );
}

const workflow = read(".github/workflows/release.yml");
for (const token of [
  "tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "updaterJsonPreferNsis: true",
  "max-parallel: 1",
  "prerelease: ${{ steps.release.outputs.prerelease }}",
]) {
  assert(workflow.includes(token), `Release workflow is missing ${token}`);
}
assert(!workflow.includes("workflow_dispatch:"), "Production releases must be triggered by tags only");
assert(
  !workflow.includes("uses: tauri-apps/tauri-action@v1"),
  "The updater publishing action must be pinned to a reviewed commit",
);

const previewConfig = JSON.parse(read("src-tauri/tauri.unsigned-preview.json"));
assert(
  previewConfig.bundle?.createUpdaterArtifacts === false,
  "Unsigned preview builds must not create updater artifacts",
);

const previewWorkflow = read(".github/workflows/preview.yml");
for (const token of [
  "macos-15",
  "windows-2022",
  "ubuntu-22.04",
  "--bundles dmg",
  "--bundles nsis",
  "--bundles appimage,deb",
  "--config src-tauri/tauri.unsigned-preview.json",
  "if-no-files-found: error",
]) {
  assert(previewWorkflow.includes(token), `Preview workflow is missing ${token}`);
}
assert(
  previewWorkflow.includes("permissions:\n  contents: read"),
  "Preview workflow permissions must remain read-only",
);
assert(
  !previewWorkflow.includes("secrets."),
  "Unsigned preview builds must not consume repository secrets",
);
assert(
  !previewWorkflow.includes("actions/upload-artifact@v4"),
  "Preview artifact upload action must be pinned to a reviewed commit",
);

const updatePreviewConfig = JSON.parse(read("src-tauri/tauri.update-preview.json"));
assert(
  updatePreviewConfig.bundle?.createUpdaterArtifacts === true,
  "Update previews must create independently signed updater artifacts",
);
assert(
  updatePreviewConfig.plugins?.updater?.endpoints?.[0] ===
    "https://github.com/majiayu000/dsh-desk/releases/download/preview-channel/latest.json",
  "Update previews must use the isolated preview channel",
);

const updatePreviewWorkflow = read(".github/workflows/update-preview.yml");
for (const token of [
  "workflow_dispatch:",
  "max-parallel: 1",
  "preview-v__VERSION__",
  "--bundles app,dmg",
  "src-tauri/tauri.update-preview.json",
  "pnpm check:updater-key",
  "node scripts/validate-update-manifest.mjs",
  "tag_name: preview-channel",
  "overwrite_files: true",
]) {
  assert(updatePreviewWorkflow.includes(token), `Update preview workflow is missing ${token}`);
}
assert(
  !updatePreviewWorkflow.includes("APPLE_CERTIFICATE") &&
    !updatePreviewWorkflow.includes("WINDOWS_CERTIFICATE"),
  "Update previews must not pretend to use unavailable OS signing identities",
);
assert(
  !updatePreviewWorkflow.includes("uses: tauri-apps/tauri-action@v1") &&
    !updatePreviewWorkflow.includes("uses: softprops/action-gh-release@v2"),
  "Update preview publishing actions must be pinned to reviewed commits",
);

console.log("Updater configuration, signing, release, and capability contracts passed.");
