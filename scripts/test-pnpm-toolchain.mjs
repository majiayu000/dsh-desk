import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertContract as assert } from "./lib/contract.mjs";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
const pnpmVersion = packageJson.dependencies.pnpm;

assert(typeof pnpmVersion === "string" && pnpmVersion.length > 0, "package.json must pin pnpm");
assert(
  packageJson.packageManager === `pnpm@${pnpmVersion}`,
  "packageManager must match the pnpm dependency pin",
);
assert(
  /^  pnpm: true$/m.test(workspace),
  "pnpm-workspace.yaml must approve pnpm's install script so the native binary is linked offline",
);

const workflowDir = join(root, ".github", "workflows");
for (const name of readdirSync(workflowDir).filter((file) => file.endsWith(".yml"))) {
  const text = readFileSync(join(workflowDir, name), "utf8");
  if (!text.includes("pnpm/action-setup")) continue;
  const blocks = text.split(/- uses: pnpm\/action-setup[^\n]*/).slice(1);
  assert(blocks.length > 0, `${name} must pin pnpm/action-setup`);
  for (const [index, block] of blocks.entries()) {
    const version = block.match(/^\s+version:\s*(\S+)/m)?.[1];
    assert(
      version === pnpmVersion,
      `${name} action-setup #${index + 1} pins ${version}, expected ${pnpmVersion}`,
    );
  }
}

const runtimeLauncher = readFileSync(join(root, "scripts", "prepare-runtime.mjs"), "utf8");
const pluginManager = readFileSync(join(root, "src-tauri", "src", "plugin_manager.rs"), "utf8");
for (const [name, source] of [
  ["prepare-runtime.mjs", runtimeLauncher],
  ["plugin_manager.rs", pluginManager],
]) {
  assert(!source.includes("pnpm.cjs"), `${name} must not launch the pnpm 11 CLI entry`);
  assert(source.includes("pnpm/bin/pnpm.mjs"), `${name} must launch pnpm 12 through bin/pnpm.mjs`);
}

console.log(`pnpm toolchain pin ${pnpmVersion} is aligned across package.json, CI, and runtime launchers.`);
