import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargoToml = read("src-tauri/Cargo.toml");
const cargoPackage = cargoToml.match(/\[package\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/)?.[1];
const cargoVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];

assert(cargoVersion === packageJson.version, "Cargo.toml version must match package.json");
assert(tauriConfig.version === packageJson.version, "tauri.conf.json version must match package.json");
assert(tauriConfig.bundle?.createUpdaterArtifacts === true, "Tauri updater artifacts must be enabled");

const updater = tauriConfig.plugins?.updater;
assert(updater, "Tauri updater configuration is missing");
assert(updater.endpoints?.length === 1, "The stable channel must have exactly one updater endpoint");
assert(
  updater.endpoints[0] === "https://github.com/majiayu000/dsh-desk/releases/latest/download/latest.json",
  "The stable updater endpoint must use the public GitHub latest release",
);
assert(updater.windows?.installMode === "passive", "Windows updates must use passive NSIS mode");

const decodedPublicKey = Buffer.from(updater.pubkey, "base64").toString("utf8");
assert(decodedPublicKey.includes("minisign public key"), "Updater public key is not a minisign public key");

const capabilityDir = resolve(root, "src-tauri/capabilities");
for (const name of readdirSync(capabilityDir).filter((name) => name.endsWith(".json"))) {
  const capability = JSON.parse(read(`src-tauri/capabilities/${name}`));
  const permissions = capability.permissions ?? [];
  assert(
    permissions.every((permission) => typeof permission !== "string" || !permission.startsWith("updater:")),
    `${name} must not expose updater commands to a WebView`,
  );
}

const workflow = read(".github/workflows/release.yml");
for (const token of [
  "tauri-apps/tauri-action@v1",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "updaterJsonPreferNsis: true",
]) {
  assert(workflow.includes(token), `Release workflow is missing ${token}`);
}

console.log("Updater configuration, signing, release, and capability contracts passed.");
