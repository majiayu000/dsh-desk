import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  throw new Error("Missing TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH");
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  throw new Error("Missing TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
}

const root = resolve(import.meta.dirname, "..");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "dsh-updater-key-"));
const payload = join(temporaryDirectory, "payload.txt");
const signature = `${payload}.sig`;

function run(command, args, extraEnv = {}) {
  const childEnv = { ...process.env, ...extraEnv };
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[name];
  }
  const result = spawnSync(command, args, {
    cwd: root,
    env: childEnv,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    );
  }
}

try {
  writeFileSync(payload, "dsh-desk updater signing contract\n", { mode: 0o600 });
  const signingEnv = {};
  if (process.env.TAURI_SIGNING_PRIVATE_KEY && existsSync(process.env.TAURI_SIGNING_PRIVATE_KEY)) {
    signingEnv.TAURI_SIGNING_PRIVATE_KEY = undefined;
    signingEnv.TAURI_SIGNING_PRIVATE_KEY_PATH = process.env.TAURI_SIGNING_PRIVATE_KEY;
  }
  run(process.execPath, [
    resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
    "signer",
    "sign",
    payload,
  ], signingEnv);
  run("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--test",
    "updater_signing",
    "configured_public_key_verifies_the_release_signing_key",
  ], {
    DSH_UPDATER_TEST_PAYLOAD: payload,
    DSH_UPDATER_TEST_SIGNATURE: signature,
  });
  console.log("Updater release private key matches the configured public key.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
