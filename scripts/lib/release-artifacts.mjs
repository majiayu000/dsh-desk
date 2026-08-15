import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { walkFiles } from "./files.mjs";

const platformFiles = {
  macos: [".dmg", ".dmg.sha256", ".app.tar.gz", ".app.tar.gz.sig"],
  windows: [".exe", ".exe.sha256", ".exe.sig"],
  linux: [
    ".AppImage",
    ".AppImage.sha256",
    ".AppImage.sig",
    ".deb",
    ".deb.sha256",
    ".deb.sig",
  ],
};

export function stageReleaseArtifacts(platform, bundleRoot, outputDirectory) {
  const requiredSuffixes = platformFiles[platform];
  if (!requiredSuffixes) {
    throw new Error(`Unsupported release platform: ${platform}`);
  }

  const sourceRoot = resolve(bundleRoot);
  const destinationRoot = resolve(outputDirectory);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Release bundle root does not exist: ${sourceRoot}`);
  }
  mkdirSync(destinationRoot, { recursive: true });

  const staged = [];
  for (const suffix of requiredSuffixes) {
    const matches = walkFiles(sourceRoot).filter(
      (file) => file.endsWith(suffix) && !basename(file).startsWith("rw."),
    );
    if (matches.length !== 1) {
      throw new Error(
        `${platform} release requires exactly one ${suffix} artifact, found ${matches.length}`,
      );
    }
    const destination = join(destinationRoot, basename(matches[0]));
    if (existsSync(destination)) {
      throw new Error(`Refusing to overwrite staged release artifact: ${destination}`);
    }
    copyFileSync(matches[0], destination);
    staged.push(destination);
  }
  return staged;
}

export function assembleUpdateManifest({
  artifactDirectory,
  version,
  tag,
  repository,
  notes = "See the GitHub release for details.",
  pubDate = new Date().toISOString(),
}) {
  if (!version || tag !== `v${version}`) {
    throw new Error(`Release tag ${tag ?? "missing"} must match version ${version ?? "missing"}`);
  }
  if (!/^[^/]+\/[^/]+$/.test(repository ?? "")) {
    throw new Error(`Invalid GitHub repository: ${repository ?? "missing"}`);
  }

  const root = resolve(artifactDirectory);
  const files = walkFiles(root);
  const macos = signedArtifact(files, ".app.tar.gz");
  const windows = signedArtifact(files, ".exe");
  const appImage = signedArtifact(files, ".AppImage");
  const deb = signedArtifact(files, ".deb");
  const entry = (artifact) => ({
    signature: artifact.signature,
    url: releaseAssetUrl(repository, tag, basename(artifact.path)),
  });

  const macosEntry = entry(macos);
  const windowsEntry = entry(windows);
  const appImageEntry = entry(appImage);
  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": macosEntry,
      "darwin-aarch64-app": macosEntry,
      "windows-x86_64": windowsEntry,
      "windows-x86_64-nsis": windowsEntry,
      "linux-x86_64": appImageEntry,
      "linux-x86_64-appimage": appImageEntry,
      "linux-x86_64-deb": entry(deb),
    },
  };
  const output = join(root, "latest.json");
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, output };
}

function signedArtifact(files, suffix) {
  const matches = files.filter((file) => file.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`Release requires exactly one ${suffix} artifact, found ${matches.length}`);
  }
  const signaturePath = `${matches[0]}.sig`;
  if (!files.includes(signaturePath)) {
    throw new Error(`Release signature is missing for ${basename(matches[0])}`);
  }
  const signature = readFileSync(signaturePath, "utf8").trim();
  validateEncodedSignature(basename(matches[0]), signature);
  return { path: matches[0], signature };
}

export function validateEncodedSignature(name, encoded) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`Release artifact ${name} has a malformed signature`);
  }
  const lines = Buffer.from(encoded, "base64").toString("utf8").trim().split(/\r?\n/);
  if (
    lines.length !== 4 ||
    !lines[0].startsWith("untrusted comment:") ||
    !lines[2].startsWith("trusted comment:")
  ) {
    throw new Error(`Release artifact ${name} has malformed minisign data`);
  }
}

function releaseAssetUrl(repository, tag, filename) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}
