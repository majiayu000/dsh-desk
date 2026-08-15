import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
    if (!entry.isFile()) continue;

    const stat = statSync(entryPath);
    if ((stat.mode & 0o111) !== 0 || entry.name.endsWith(".node") || entry.name.endsWith(".dylib")) {
      candidates.push(entryPath);
    }
  }
  return candidates;
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
    if (!capture("/usr/bin/file", ["-b", candidate]).startsWith("Mach-O")) continue;
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

function verifyDistribution() {
  for (const artifact of [appPath, dmgPath]) {
    if (!existsSync(artifact)) throw new Error(`Release artifact is missing: ${artifact}`);
  }

  run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);
  run("xcrun", ["stapler", "validate", appPath]);

  let machOCount = 0;
  for (const candidate of collectNativeCodeCandidates(join(appPath, "Contents"))) {
    if (!capture("/usr/bin/file", ["-b", candidate]).startsWith("Mach-O")) continue;
    machOCount += 1;
    run("codesign", ["--verify", "--strict", "--verbose=2", candidate]);
    if (!hasDeveloperIdAuthority(candidate)) {
      throw new Error(`Packaged native code lacks a Developer ID Application authority: ${candidate}`);
    }
  }
  if (machOCount === 0) throw new Error(`No Mach-O binaries were found in ${appPath}`);

  run("codesign", ["--verify", "--strict", "--verbose=4", dmgPath]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
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
}

if (command === "sign-runtime") {
  signPreparedRuntime();
} else if (command === "verify-bundle") {
  verifyDistribution();
} else {
  throw new Error("Usage: node scripts/macos-release.mjs <sign-runtime|verify-bundle>");
}
