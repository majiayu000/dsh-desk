import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assertContract as assert, createContractReader } from "./lib/contract.mjs";

const root = resolve(import.meta.dirname, "..");
const read = createContractReader(root);
const catalog = JSON.parse(read("src/plugin-catalog.json"));
const packageJson = JSON.parse(read("package.json"));
const harnessVersion = packageJson.dependencies["@deepseek-ai/dsh"];

assert(catalog.schemaVersion === 1, "plugin catalog schema version must be explicit");
assert(catalog.harnessVersion === harnessVersion, "plugin catalog must match the pinned Harness");
assert(catalog.desktopVersion === packageJson.version, "plugin catalog must match the desktop version");
assert(Array.isArray(catalog.entries) && catalog.entries.length > 0, "plugin catalog must not be empty");

const ids = new Set();
const sources = new Set();
for (const entry of catalog.entries) {
  assert(!ids.has(entry.id), `duplicate plugin catalog id ${entry.id}`);
  assert(!sources.has(entry.source), `duplicate plugin catalog source ${entry.source}`);
  ids.add(entry.id);
  sources.add(entry.source);
  assert(entry.source === `${entry.package}@${entry.version}`, `${entry.id} must pin an exact source`);
  assert(entry.version === harnessVersion, `${entry.id} must match the pinned Harness family`);
  assert(["available", "bundled"].includes(entry.status), `${entry.id} has an invalid status`);
  assert(entry.trust?.reviewedAt && entry.trust?.evidence?.length > 0, `${entry.id} lacks trust evidence`);
  assert(entry.capabilities?.length > 0, `${entry.id} lacks a capability summary`);
  assert(entry.platforms?.length === 3, `${entry.id} must state all tested desktop platforms`);
}

const testHome = mkdtempSync(join(tmpdir(), "dsh-desk-catalog-"));
try {
  const dshPackage = join(root, "node_modules", "@deepseek-ai", "dsh", "package.json");
  const result = spawnSync(
    process.execPath,
    [join(dirname(dshPackage), "lib", "bin.js"), "--profile", "web", "--dump-default-config"],
    { cwd: root, encoding: "utf8", env: { ...process.env, DSH_HOME: testHome, NO_COLOR: "1" } },
  );
  if (result.error) throw result.error;
  assert(result.status === 0, `Harness catalog composition exited ${result.status}: ${result.stderr}`);
  for (const entry of catalog.entries.filter((candidate) => candidate.status === "bundled")) {
    assert(result.stdout.includes(`name: '${entry.package}'`), `${entry.package} is not mounted by Harness`);
  }
} finally {
  rmSync(testHome, { recursive: true, force: true });
}

const client = read("src/plugins.ts");
for (const token of ["renderCatalog", "beginReview('add', entry.source)", "installedNames.has(entry.package)"]) {
  assert(client.includes(token), `plugin market client is missing ${token}`);
}

console.log(`Trusted plugin catalog verified: ${catalog.entries.length} pinned entries match Harness ${harnessVersion}.`);
