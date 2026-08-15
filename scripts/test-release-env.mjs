import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const script = resolve(root, "scripts/check-release-env.mjs");
const baseEnvironment = { ...process.env };
for (const name of [
  "GITHUB_ACTIONS",
  "GITHUB_REF_NAME",
  "GITHUB_REF_TYPE",
  "WINDOWS_CERTIFICATE",
  "WINDOWS_CERTIFICATE_PASSWORD",
]) {
  delete baseEnvironment[name];
}
baseEnvironment.TAURI_SIGNING_PRIVATE_KEY = "test-updater-private-key";
baseEnvironment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "test-updater-password";

function checkWindows(environment = {}) {
  return spawnSync(process.execPath, [script, "windows"], {
    cwd: root,
    encoding: "utf8",
    env: { ...baseEnvironment, ...environment },
  });
}

const unsigned = checkWindows();
if (unsigned.status !== 0 || !unsigned.stdout.includes("unsigned Authenticode mode")) {
  throw new Error(`Windows unsigned release gate failed:\n${unsigned.stderr || unsigned.stdout}`);
}

const signed = checkWindows({
  WINDOWS_CERTIFICATE: "base64-pfx-fixture",
  WINDOWS_CERTIFICATE_PASSWORD: "pfx-password-fixture",
});
if (signed.status !== 0 || !signed.stdout.includes("Authenticode enabled")) {
  throw new Error(`Windows signed release gate failed:\n${signed.stderr || signed.stdout}`);
}

for (const environment of [
  { WINDOWS_CERTIFICATE: "base64-pfx-fixture" },
  { WINDOWS_CERTIFICATE_PASSWORD: "pfx-password-fixture" },
]) {
  const partial = checkWindows(environment);
  if (
    partial.status === 0 ||
    !partial.stderr.includes("WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD must be provided together")
  ) {
    throw new Error(`Windows release gate accepted partial Authenticode credentials:\n${partial.stderr}`);
  }
}

const missingUpdaterKey = checkWindows({ TAURI_SIGNING_PRIVATE_KEY: "" });
if (missingUpdaterKey.status === 0 || !missingUpdaterKey.stderr.includes("TAURI_SIGNING_PRIVATE_KEY")) {
  throw new Error("Windows release gate accepted a missing Tauri updater private key");
}

console.log("Optional Windows Authenticode release environment contracts passed.");
