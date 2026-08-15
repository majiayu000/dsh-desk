import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  assembleUpdateManifest,
  stageReleaseArtifacts,
} from "./lib/release-artifacts.mjs";

const directory = mkdtempSync(resolve(tmpdir(), "dsh-release-artifacts-"));
const version = "0.1.0-alpha.9";
const tag = `v${version}`;
const signature = Buffer.from(
  "untrusted comment: test signature\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\ntrusted comment: test timestamp\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
).toString("base64");
const names = [
  `DSH Desk_${version}_aarch64.app.tar.gz`,
  `DSH Desk_${version}_x64-setup.exe`,
  `DSH Desk_${version}_amd64.AppImage`,
  `DSH Desk_${version}_amd64.deb`,
];

try {
  for (const name of names) {
    writeFileSync(join(directory, name), "artifact");
    writeFileSync(join(directory, `${name}.sig`), signature);
  }

  const bundleRoot = join(directory, "bundle");
  const stagedRoot = join(directory, "staged-linux");
  mkdirSync(join(bundleRoot, "nested"), { recursive: true });
  for (const suffix of [
    ".AppImage",
    ".AppImage.sha256",
    ".AppImage.sig",
    ".deb",
    ".deb.sha256",
    ".deb.sig",
  ]) {
    writeFileSync(join(bundleRoot, "nested", `DSH.Desk${suffix}`), "fixture");
  }
  const staged = stageReleaseArtifacts("linux", bundleRoot, stagedRoot);
  if (staged.length !== 6) throw new Error(`Expected 6 staged Linux artifacts, got ${staged.length}`);
  rmSync(bundleRoot, { recursive: true, force: true });
  rmSync(stagedRoot, { recursive: true, force: true });

  const { manifest, output } = assembleUpdateManifest({
    artifactDirectory: directory,
    version,
    tag,
    repository: "majiayu000/dsh-desk",
    notes: "Release notes",
    pubDate: "2026-08-15T00:00:00.000Z",
  });
  if (JSON.parse(readFileSync(output, "utf8")).version !== version) {
    throw new Error("Release manifest was not written");
  }
  if (manifest.platforms["darwin-aarch64"] !== manifest.platforms["darwin-aarch64-app"]) {
    throw new Error("Generic and app-specific macOS targets must share one artifact");
  }
  if (manifest.platforms["windows-x86_64"] !== manifest.platforms["windows-x86_64-nsis"]) {
    throw new Error("Generic and NSIS-specific Windows targets must share one artifact");
  }
  for (const entry of Object.values(manifest.platforms)) {
    if (!entry.url.includes("DSH%20Desk_")) {
      throw new Error(`Release asset URL is not encoded: ${entry.url}`);
    }
  }

  rmSync(join(directory, `${names.at(-1)}.sig`));
  try {
    assembleUpdateManifest({
      artifactDirectory: directory,
      version,
      tag,
      repository: "majiayu000/dsh-desk",
    });
    throw new Error("Release manifest accepted a missing signature");
  } catch (error) {
    if (!String(error.message).includes(`signature is missing for ${basename(names.at(-1))}`)) {
      throw error;
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Release artifact aggregation and updater manifest contracts passed.");
