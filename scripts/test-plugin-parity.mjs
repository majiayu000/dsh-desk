import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const fixture = join(projectRoot, "tests", "fixtures", "dsh-test-plugin");
const development = {
  node: process.execPath,
  entry: join(projectRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
  bin: join(projectRoot, "node_modules", ".bin"),
};
const packaged = {
  node: process.platform === "win32"
    ? join(projectRoot, "resources", "runtime", "node", "node.exe")
    : join(projectRoot, "resources", "runtime", "node", "bin", "node"),
  entry: join(
    projectRoot,
    "resources",
    "runtime",
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  ),
  bin: join(projectRoot, "resources", "runtime", "tools", "bin"),
};
const root = mkdtempSync(join(tmpdir(), "dsh-desk-plugin-parity-"));
const referenceHome = join(root, "reference");
const desktopHome = join(root, "desktop");
const packageSpec = `file:${fixture}`;

function run(runtime, home, args) {
  const path = [runtime.bin, process.env.PATH ?? ""].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
  const result = spawnSync(runtime.node, [runtime.entry, ...args], {
    cwd: projectRoot,
    env: { ...process.env, DSH_HOME: home, PATH: path, NO_COLOR: "1" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${runtime.entry} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function profileFile(home, name) {
  return readFileSync(join(home, "profiles", "web", name), "utf8");
}

function normalizeLockfileImporter(value) {
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const importersIndex = lines.indexOf("importers:");
  if (importersIndex === -1) {
    throw new Error("pnpm-lock.yaml does not contain an importers section");
  }

  const importerIndex = lines.findIndex(
    (line, index) => index > importersIndex && /^  \S.*:$/.test(line),
  );
  if (importerIndex === -1) {
    return lines.join("\n");
  }

  // On Windows, pnpm can make the importer key relative to a workspace on a
  // different drive, which embeds each temporary profile's directory name.
  // The importer location is expected to differ; its complete dependency tree
  // below this key must still match byte-for-byte.
  lines[importerIndex] = "  <profile-importer>:";
  return lines.join("\n");
}

function assertEqual(label, left, right) {
  if (left !== right) {
    const leftLines = left.replaceAll("\r\n", "\n").split("\n");
    const rightLines = right.replaceAll("\r\n", "\n").split("\n");
    const lineCount = Math.max(leftLines.length, rightLines.length);
    let firstDifference = 0;
    while (
      firstDifference < lineCount
      && leftLines[firstDifference] === rightLines[firstDifference]
    ) {
      firstDifference += 1;
    }
    const start = Math.max(0, firstDifference - 2);
    const end = Math.min(lineCount, firstDifference + 3);
    const context = [];
    for (let index = start; index < end; index += 1) {
      context.push(
        `${index + 1}: original=${JSON.stringify(leftLines[index] ?? "<missing>")}`,
        `${index + 1}: packaged=${JSON.stringify(rightLines[index] ?? "<missing>")}`,
      );
    }
    throw new Error(
      `${label} differs between original dsh and DSH Desk runtime `
      + `(original ${left.length} bytes, packaged ${right.length} bytes; `
      + `first normalized difference at line ${firstDifference + 1})\n${context.join("\n")}`,
    );
  }
}

try {
  for (const [runtime, home] of [[development, referenceHome], [packaged, desktopHome]]) {
    run(runtime, home, ["plugin", "--profile", "web", "add", packageSpec]);
  }

  assertEqual(
    "profile package.json after add",
    profileFile(referenceHome, "package.json"),
    profileFile(desktopHome, "package.json"),
  );
  assertEqual(
    "pnpm-lock.yaml after add",
    normalizeLockfileImporter(profileFile(referenceHome, "pnpm-lock.yaml")),
    normalizeLockfileImporter(profileFile(desktopHome, "pnpm-lock.yaml")),
  );
  assertEqual(
    "composed config after add",
    run(development, referenceHome, ["--profile", "web", "--dump-config"]),
    run(packaged, desktopHome, ["--profile", "web", "--dump-config"]),
  );

  run(development, referenceHome, ["plugin", "--profile", "web", "why", "@dsh-desk/test-plugin"]);
  run(packaged, desktopHome, ["plugin", "--profile", "web", "why", "@dsh-desk/test-plugin"]);

  run(development, referenceHome, ["plugin", "--profile", "web", "update", "@dsh-desk/test-plugin"]);
  run(packaged, desktopHome, ["plugin", "--profile", "web", "update", "@dsh-desk/test-plugin"]);
  assertEqual(
    "profile package.json after update",
    profileFile(referenceHome, "package.json"),
    profileFile(desktopHome, "package.json"),
  );
  assertEqual(
    "pnpm-lock.yaml after update",
    normalizeLockfileImporter(profileFile(referenceHome, "pnpm-lock.yaml")),
    normalizeLockfileImporter(profileFile(desktopHome, "pnpm-lock.yaml")),
  );

  for (const [runtime, home] of [[development, referenceHome], [packaged, desktopHome]]) {
    run(runtime, home, ["plugin", "--profile", "web", "remove", "@dsh-desk/test-plugin"]);
  }
  assertEqual(
    "profile package.json after remove",
    profileFile(referenceHome, "package.json"),
    profileFile(desktopHome, "package.json"),
  );
  assertEqual(
    "pnpm-lock.yaml after remove",
    normalizeLockfileImporter(profileFile(referenceHome, "pnpm-lock.yaml")),
    normalizeLockfileImporter(profileFile(desktopHome, "pnpm-lock.yaml")),
  );

  console.log("Plugin parity verified: add, why, update, dump-config, and remove match original dsh.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
