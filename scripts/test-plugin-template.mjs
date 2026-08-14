import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "dsh-desk-plugin-template-"));
const target = join(root, "generated-plugin");

try {
  const result = spawnSync(
    process.execPath,
    [resolve(projectRoot, "scripts/create-plugin.mjs"), target, "@dsh-desk/generated-test"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  if (manifest.name !== "@dsh-desk/generated-test") throw new Error("generated package name differs");
  if (manifest.scripts && Object.keys(manifest.scripts).length > 0) {
    throw new Error("safe template must not include lifecycle scripts");
  }
  if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    throw new Error("generated package does not declare a DSH bundle patch");
  }
  JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  readFileSync(join(target, "cordis.patch.yml"), "utf8");
  console.log("Plugin template verified: scaffold, manifest, safe scripts, and patch entry.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
