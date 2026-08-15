import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(resolve(tmpdir(), "dsh-update-manifest-"));
const manifestPath = resolve(directory, "latest.json");
const releasePath = resolve(directory, "release.json");
const currentManifestPath = resolve(directory, "current.json");
const version = "0.1.0-alpha.2";
const tag = `v${version}`;
const targets = [
  "darwin-aarch64",
  "darwin-aarch64-app",
  "windows-x86_64",
  "windows-x86_64-nsis",
  "linux-x86_64",
  "linux-x86_64-appimage",
  "linux-x86_64-deb",
];
const signature = Buffer.from(
  "untrusted comment: test signature\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\ntrusted comment: test timestamp\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
).toString("base64");
const targetUrls = {
  "darwin-aarch64": `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/DSH.Desk.app.tar.gz`,
  "darwin-aarch64-app": `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/DSH.Desk.app.tar.gz`,
  "windows-x86_64": `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/DSH.Desk-setup.exe`,
  "windows-x86_64-nsis": `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/DSH.Desk-setup.exe`,
  "linux-x86_64": `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/DSH.Desk.AppImage`,
  "linux-x86_64-appimage": `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/DSH.Desk.AppImage`,
  "linux-x86_64-deb": `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/DSH.Desk.deb`,
};

function manifest(encodedSignature = signature) {
  return {
    version,
    platforms: Object.fromEntries(
      targets.map((target) => [
        target,
        {
          signature: encodedSignature,
          url: targetUrls[target],
        },
      ]),
    ),
  };
}

function validate() {
  return spawnSync(
    process.execPath,
    [
      resolve(root, "scripts/validate-update-manifest.mjs"),
      manifestPath,
      version,
      tag,
      releasePath,
      currentManifestPath,
    ],
    { encoding: "utf8" },
  );
}

try {
  writeFileSync(
    releasePath,
    JSON.stringify({
      tag_name: tag,
      draft: false,
      prerelease: true,
      assets: [...new Set(Object.values(targetUrls))].map((url, index) => ({
        url: `https://api.github.com/assets/${index}`,
        browser_download_url: url,
      })),
    }),
  );
  writeFileSync(currentManifestPath, JSON.stringify({ version: "0.1.0-alpha.1" }));
  writeFileSync(manifestPath, JSON.stringify(manifest()));
  const valid = validate();
  if (valid.status !== 0) throw new Error(valid.stderr || valid.stdout);
  const normalized = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (normalized.version !== version) throw new Error("validator changed the manifest version");

  writeFileSync(manifestPath, JSON.stringify(manifest("not-a-minisign-signature")));
  const invalidSignature = validate();
  if (invalidSignature.status === 0) throw new Error("validator accepted an empty signature");

  writeFileSync(
    releasePath,
    JSON.stringify({ tag_name: "v0.1.0-foreign", draft: false, prerelease: true }),
  );
  writeFileSync(manifestPath, JSON.stringify(manifest()));
  const wrongRelease = validate();
  if (wrongRelease.status === 0) throw new Error("validator accepted metadata from another release");

  writeFileSync(
    releasePath,
    JSON.stringify({
      tag_name: tag,
      draft: false,
      prerelease: true,
      assets: [...new Set(Object.values(targetUrls))].map((url) => ({
        browser_download_url: url,
      })),
    }),
  );
  writeFileSync(currentManifestPath, JSON.stringify({ version: "0.1.0-alpha.3" }));
  writeFileSync(manifestPath, JSON.stringify(manifest()));
  const downgrade = validate();
  if (downgrade.status === 0) throw new Error("validator accepted an update channel downgrade");

  writeFileSync(currentManifestPath, JSON.stringify({ version: "0.1.0-alpha.1" }));
  const foreignAsset = manifest();
  foreignAsset.platforms["linux-x86_64-deb"].url =
    `https://github.com/majiayu000/dsh-desk/releases/download/${tag}/foreign.deb`;
  writeFileSync(manifestPath, JSON.stringify(foreignAsset));
  const unownedAsset = validate();
  if (unownedAsset.status === 0) throw new Error("validator accepted an unowned release asset");

  writeFileSync(
    releasePath,
    JSON.stringify({
      tag_name: tag,
      draft: false,
      prerelease: false,
      assets: [...new Set(Object.values(targetUrls))].map((url) => ({
        browser_download_url: url,
      })),
    }),
  );
  writeFileSync(manifestPath, JSON.stringify(manifest()));
  const wrongChannel = validate();
  if (wrongChannel.status === 0) throw new Error("validator accepted a mismatched release channel");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Update manifest validator rejects incomplete or mismatched metadata.");
