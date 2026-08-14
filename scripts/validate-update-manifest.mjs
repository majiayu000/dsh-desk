import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [manifestPath, expectedVersion] = process.argv.slice(2);
if (!manifestPath || !expectedVersion) {
  throw new Error("Usage: node scripts/validate-update-manifest.mjs <latest.json> <version>");
}

const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
if (manifest.version !== expectedVersion) {
  throw new Error(`Update manifest version ${manifest.version ?? "missing"} does not match ${expectedVersion}`);
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

console.log(`Update manifest ${expectedVersion} contains signed artifacts for all preview targets.`);
