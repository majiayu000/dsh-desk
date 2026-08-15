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
  const action = readFileSync(resolve(projectRoot, "plugin-verification/action.yml"), "utf8");
  for (const command of ["plugin --profile web add", "--dump-config", "plugin --profile web why", "plugin --profile web update", "plugin --profile web remove"]) {
    if (!action.includes(command)) throw new Error(`plugin verification action is missing ${command}`);
  }
  if (!action.includes("candidate self-check refuses lifecycle scripts")) {
    throw new Error("plugin verification action must reject lifecycle scripts from self-service checks");
  }
  if (!action.includes('signal_type: "plugin_candidate_compatibility"')) {
    throw new Error("plugin verification action must emit the structured compatibility signal");
  }
  console.log("Plugin tooling verified: scaffold, safe scripts, patch entry, and candidate action lifecycle.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
