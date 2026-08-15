import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2];
const projectRoot = resolve(import.meta.dirname, "..");
const runtimePath = join(projectRoot, "resources", "runtime");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const bundleRoot = join(projectRoot, "src-tauri", "target", "release", "bundle");
const appPath = join(bundleRoot, "macos", "DSH Desk.app");
const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
const dmgPath = join(bundleRoot, "dmg", `DSH Desk_${packageJson.version}_${architecture}.dmg`);
const machOMagicValues = new Set([
  0xfeedface,
  0xfeedfacf,
  0xcefaedfe,
  0xcffaedfe,
  0xcafebabe,
  0xcafebabf,
  0xbebafeca,
  0xbfbafeca,
]);

if (process.platform !== "darwin") {
  throw new Error("macOS release signing and verification must run on macOS");
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${executable} failed with status ${result.status}`);
  }
}

function capture(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${executable} failed with status ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function collectNativeCodeCandidates(root) {
  const candidates = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...collectNativeCodeCandidates(entryPath));
      continue;
    }
    if (entry.isFile()) candidates.push(entryPath);
  }
  return candidates;
}

function isMachO(filePath) {
  const descriptor = openSync(filePath, "r");
  try {
    const magic = Buffer.allocUnsafe(4);
    if (readSync(descriptor, magic, 0, magic.length, 0) !== magic.length) return false;
    return machOMagicValues.has(magic.readUInt32BE(0));
  } finally {
    closeSync(descriptor);
  }
}

function codeSigningAuthority(filePath) {
  const result = spawnSync("codesign", ["-dv", "--verbose=2", filePath], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  return result.stderr.match(/^Authority=(.+)$/m)?.[1];
}

function hasDeveloperIdAuthority(filePath) {
  return codeSigningAuthority(filePath)?.startsWith("Developer ID Application:") ?? false;
}

function resolveSigningIdentity() {
  if (process.env.APPLE_SIGNING_IDENTITY) return process.env.APPLE_SIGNING_IDENTITY;

  const identities = capture("security", ["find-identity", "-v", "-p", "codesigning"])
    .split("\n")
    .map((line) => line.match(/"(Developer ID Application: [^"]+)"/)?.[1])
    .filter(Boolean);

  if (identities.length === 0) {
    throw new Error("No valid Developer ID Application identity was found in the keychain");
  }
  if (identities.length > 1) {
    throw new Error(
      "Multiple Developer ID Application identities were found; set APPLE_SIGNING_IDENTITY explicitly",
    );
  }
  return identities[0];
}

function signPreparedRuntime() {
  if (!existsSync(runtimePath)) {
    throw new Error(`Prepared runtime is missing: ${runtimePath}`);
  }

  const signingIdentity = resolveSigningIdentity();
  let machOCount = 0;
  let signedCount = 0;
  for (const candidate of collectNativeCodeCandidates(runtimePath)) {
    if (!isMachO(candidate)) continue;
    machOCount += 1;

    if (!hasDeveloperIdAuthority(candidate)) {
      run("codesign", [
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--sign",
        signingIdentity,
        candidate,
      ]);
      signedCount += 1;
    }

    run("codesign", ["--verify", "--strict", "--verbose=2", candidate]);
    if (!hasDeveloperIdAuthority(candidate)) {
      throw new Error(`Bundled native code lacks a Developer ID Application authority: ${candidate}`);
    }
  }

  if (machOCount === 0) {
    throw new Error(`No Mach-O binaries were found in the prepared runtime: ${runtimePath}`);
  }
  console.log(`Verified ${machOCount} bundled Mach-O binaries; signed ${signedCount}`);
}

function notarizeDmg() {
  if (!existsSync(dmgPath)) throw new Error(`Release artifact is missing: ${dmgPath}`);

  const required = ["APPLE_API_KEY_PATH", "APPLE_API_KEY", "APPLE_API_ISSUER"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`DMG notarization is blocked: missing ${missing.join(", ")}`);
  }

  run("xcrun", [
    "notarytool",
    "submit",
    dmgPath,
    "--wait",
    "--key",
    process.env.APPLE_API_KEY_PATH,
    "--key-id",
    process.env.APPLE_API_KEY,
    "--issuer",
    process.env.APPLE_API_ISSUER,
  ]);
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "validate", dmgPath]);
}

function verifyDistribution() {
  if (!existsSync(dmgPath)) throw new Error(`Release artifact is missing: ${dmgPath}`);

  let verifiedAppPath = appPath;
  let mountPath;
  try {
    if (!existsSync(verifiedAppPath)) {
      mountPath = mkdtempSync(join(tmpdir(), "dsh-desk-verify-"));
      run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPath, dmgPath]);
      verifiedAppPath = join(mountPath, "DSH Desk.app");
      if (!existsSync(verifiedAppPath)) {
        throw new Error(`Release application is missing from mounted DMG: ${verifiedAppPath}`);
      }
    }

    run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", verifiedAppPath]);
    run("xcrun", ["stapler", "validate", verifiedAppPath]);

    let machOCount = 0;
    for (const candidate of collectNativeCodeCandidates(join(verifiedAppPath, "Contents"))) {
      if (!isMachO(candidate)) continue;
      machOCount += 1;
      run("codesign", ["--verify", "--strict", "--verbose=2", candidate]);
      if (!hasDeveloperIdAuthority(candidate)) {
        throw new Error(`Packaged native code lacks a Developer ID Application authority: ${candidate}`);
      }
    }
    if (machOCount === 0) throw new Error(`No Mach-O binaries were found in ${verifiedAppPath}`);

    run("codesign", ["--verify", "--strict", "--verbose=4", dmgPath]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=4", verifiedAppPath]);
    run("spctl", [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      dmgPath,
    ]);
    console.log(`Verified notarized macOS distribution with ${machOCount} Mach-O binaries`);
  } finally {
    if (mountPath) {
      try {
        run("hdiutil", ["detach", mountPath]);
      } finally {
        rmSync(mountPath, { recursive: true, force: true });
      }
    }
  }
}

if (command === "sign-runtime") {
  signPreparedRuntime();
} else if (command === "notarize-dmg") {
  notarizeDmg();
} else if (command === "verify-bundle") {
  verifyDistribution();
} else {
  throw new Error(
    "Usage: node scripts/macos-release.mjs <sign-runtime|notarize-dmg|verify-bundle>",
  );
}
