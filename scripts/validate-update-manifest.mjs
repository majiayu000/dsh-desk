import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compare, prerelease, valid } from "semver";
import { validateEncodedSignature } from "./lib/release-artifacts.mjs";

const [manifestPath, expectedVersion, expectedTag, releasePath, currentManifestPath] =
  process.argv.slice(2);
if (!manifestPath || !expectedVersion || !expectedTag || !releasePath) {
  throw new Error(
    "Usage: node scripts/validate-update-manifest.mjs <latest.json> <version> <tag> <release.json> [current-latest.json]",
  );
}

const resolvedManifestPath = resolve(manifestPath);
const manifest = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
const release = JSON.parse(readFileSync(resolve(releasePath), "utf8"));

if (manifest.version !== expectedVersion) {
  throw new Error(
    `Update manifest version ${manifest.version ?? "missing"} does not match ${expectedVersion}`,
  );
}
const allowDraftRelease = process.env.DSH_ALLOW_DRAFT_RELEASE === "1";
if (release.tag_name !== expectedTag || (release.draft && !allowDraftRelease)) {
  throw new Error(`Release ${release.tag_name ?? "missing"} is not the published ${expectedTag}`);
}
const expectedPrerelease = prerelease(expectedVersion) !== null;
if (release.prerelease !== expectedPrerelease) {
  throw new Error(
    `Release prerelease flag ${release.prerelease ?? "missing"} does not match ${expectedVersion}`,
  );
}
if (currentManifestPath && existsSync(resolve(currentManifestPath))) {
  const current = JSON.parse(readFileSync(resolve(currentManifestPath), "utf8"));
  if (!valid(expectedVersion) || !valid(current.version)) {
    throw new Error(
      `Invalid update channel version: ${current.version ?? "missing"} -> ${expectedVersion}`,
    );
  }
  if (compare(expectedVersion, current.version) <= 0) {
    throw new Error(`Refusing to replace update channel ${current.version} with ${expectedVersion}`);
  }
}

const assets = release.assets ?? [];
const publicUrls = new Map(assets.map((asset) => [asset.url, asset.browser_download_url]));
const publicAssetUrls = new Set(
  assets.map((asset) => new URL(asset.browser_download_url).href),
);
for (const [target, entry] of Object.entries(manifest.platforms ?? {})) {
  if (!entry?.url) continue;
  const url = new URL(entry.url);
  if (url.hostname === "api.github.com") {
    const publicUrl = publicUrls.get(entry.url);
    if (!publicUrl) {
      throw new Error(`${target} points to an unknown GitHub Release asset: ${entry.url}`);
    }
    entry.url = publicUrl;
  }
}

const requiredTargets = [
  "darwin-aarch64",
  "darwin-aarch64-app",
  "windows-x86_64",
  "windows-x86_64-nsis",
  "linux-x86_64",
  "linux-x86_64-appimage",
  "linux-x86_64-deb",
];
const suffixes = new Map([
  ["darwin-aarch64", ".app.tar.gz"],
  ["darwin-aarch64-app", ".app.tar.gz"],
  ["windows-x86_64", ".exe"],
  ["windows-x86_64-nsis", ".exe"],
  ["linux-x86_64", ".appimage"],
  ["linux-x86_64-appimage", ".appimage"],
  ["linux-x86_64-deb", ".deb"],
]);
for (const target of requiredTargets) {
  const entry = manifest.platforms?.[target];
  if (!entry) throw new Error(`Update manifest is missing ${target}`);
  validateEncodedSignature(target, entry.signature);
  const url = new URL(entry.url);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error(`${target} update must use an HTTPS GitHub Release URL`);
  }
  if (!url.pathname.includes(`/releases/download/${expectedTag}/`)) {
    throw new Error(`${target} update URL does not point at ${expectedTag}`);
  }
  if (!publicAssetUrls.has(url.href)) {
    throw new Error(`${target} update URL is not an asset of ${expectedTag}`);
  }
  const filename = decodeURIComponent(url.pathname).toLowerCase();
  if (!filename.endsWith(suffixes.get(target))) {
    throw new Error(`${target} update URL has the wrong installer format`);
  }
}
for (const [generic, specific] of [
  ["darwin-aarch64", "darwin-aarch64-app"],
  ["windows-x86_64", "windows-x86_64-nsis"],
  ["linux-x86_64", "linux-x86_64-appimage"],
]) {
  const left = manifest.platforms[generic];
  const right = manifest.platforms[specific];
  if (left.url !== right.url || left.signature !== right.signature) {
    throw new Error(`${generic} and ${specific} must identify the same signed artifact`);
  }
}

if (process.env.DSH_VERIFY_UPDATE_ARTIFACTS === "1") {
  await verifyArtifacts(manifest, requiredTargets);
}

writeFileSync(resolvedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Update manifest ${expectedVersion} contains signed artifacts for all targets.`);

async function verifyArtifacts(candidate, targets) {
  const directory = mkdtempSync(resolve(tmpdir(), "dsh-release-artifacts-"));
  try {
    const verified = new Set();
    for (const target of targets) {
      const entry = candidate.platforms[target];
      const identity = `${entry.url}\0${entry.signature}`;
      if (verified.has(identity)) continue;
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`Failed to download ${target}: HTTP ${response.status}`);
      const artifactPath = resolve(directory, `${verified.size}.update`);
      writeFileSync(artifactPath, Buffer.from(await response.arrayBuffer()));
      execFileSync(
        "cargo",
        [
          "test",
          "--manifest-path",
          "src-tauri/Cargo.toml",
          "--test",
          "updater_signing",
          "provided_update_artifact_has_valid_signature",
          "--",
          "--ignored",
          "--exact",
        ],
        {
          env: {
            ...process.env,
            DSH_UPDATER_ARTIFACT: artifactPath,
            DSH_UPDATER_ARTIFACT_SIGNATURE: entry.signature,
          },
          stdio: "inherit",
        },
      );
      verified.add(identity);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
