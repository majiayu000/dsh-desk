import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [manifestPath, expectedVersion, releasePath] = process.argv.slice(2);
if (!manifestPath || !expectedVersion) {
  throw new Error(
    "Usage: node scripts/validate-update-manifest.mjs <latest.json> <version> [release.json]",
  );
}

const resolvedManifestPath = resolve(manifestPath);
const manifest = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
if (manifest.version !== expectedVersion) {
  throw new Error(`Update manifest version ${manifest.version ?? "missing"} does not match ${expectedVersion}`);
}

if (releasePath) {
  const release = JSON.parse(readFileSync(resolve(releasePath), "utf8"));
  if (release.tag_name !== `preview-v${expectedVersion}`) {
    throw new Error(`Release tag ${release.tag_name ?? "missing"} does not match preview-v${expectedVersion}`);
  }

  const publicUrls = new Map(
    (release.assets ?? []).map((asset) => [asset.url, asset.browser_download_url]),
  );
  for (const [target, entry] of Object.entries(manifest.platforms ?? {})) {
    if (!entry?.url) continue;
    const url = new URL(entry.url);
    if (url.hostname !== "api.github.com") continue;

    const publicUrl = publicUrls.get(entry.url);
    if (!publicUrl) {
      throw new Error(`${target} points to an unknown GitHub Release asset: ${entry.url}`);
    }
    entry.url = publicUrl;
  }
}

const platforms = manifest.platforms ?? {};
for (const target of ["darwin-aarch64", "windows-x86_64", "linux-x86_64"]) {
  const entry = platforms[target];
  if (!entry) throw new Error(`Update manifest is missing ${target}`);
  if (!entry.signature?.trim()) throw new Error(`Update manifest is missing the ${target} signature`);
  const url = new URL(entry.url);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error(`${target} update must use an HTTPS GitHub Release URL`);
  }
  if (!url.pathname.includes(`/releases/download/preview-v${expectedVersion}/`)) {
    throw new Error(`${target} update URL does not point at the versioned preview release`);
  }
}

if (releasePath) {
  writeFileSync(resolvedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`Update manifest ${expectedVersion} contains signed artifacts for all preview targets.`);
