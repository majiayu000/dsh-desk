import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runtimeRoot = resolve(projectRoot, "resources", "runtime");
const expectedSuffix = ["resources", "runtime"].join(sep);

if (!runtimeRoot.endsWith(expectedSuffix) || runtimeRoot === projectRoot) {
  throw new Error(`Unsafe runtime output path: ${runtimeRoot}`);
}

const nodeVersion = process.versions.node;
if (Number(nodeVersion.split(".")[0]) !== 24) {
  throw new Error(`Release runtime must be prepared with Node 24, got ${nodeVersion}`);
}

const platformKey = `${process.platform}-${process.arch}`;
const stagingRoot = mkdtempSync(join(tmpdir(), `dsh-desk-runtime-${platformKey}-`));
const nodeBinDir = dirname(process.execPath);
const env = {
  ...process.env,
  PATH: `${nodeBinDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
};

function makeSymlinksPortable(root, sourceRoot, destinationRoot) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      makeSymlinksPortable(path, sourceRoot, destinationRoot);
      continue;
    }
    if (!stat.isSymbolicLink()) {
      continue;
    }

    const target = readlinkSync(path);
    if (!isAbsolute(target)) {
      continue;
    }

    const canonicalTarget = realpathSync(path);
    const sourceRelative = relative(sourceRoot, canonicalTarget);
    if (sourceRelative.startsWith("..") || isAbsolute(sourceRelative)) {
      throw new Error(`Runtime symlink escapes deployed modules: ${path} -> ${target}`);
    }

    const portableTarget = relative(dirname(path), join(destinationRoot, sourceRelative));
    rmSync(path);
    symlinkSync(portableTarget, path);
  }
}

try {
  const deploy = spawnSync(
    "pnpm",
    ["--config.node-linker=hoisted", "--filter", "dsh-desk", "deploy", "--prod", stagingRoot],
    { cwd: projectRoot, env, stdio: "inherit" },
  );
  if (deploy.status !== 0) {
    throw new Error(`pnpm deploy failed with status ${deploy.status}`);
  }

  const deployedModules = join(stagingRoot, "node_modules");
  const harnessEntry = join(deployedModules, "@deepseek-ai", "dsh", "lib", "bin.js");
  if (!existsSync(harnessEntry)) {
    throw new Error(`Harness entry missing after deploy: ${harnessEntry}`);
  }

  mkdirSync(runtimeRoot, { recursive: true });
  for (const name of ["node_modules", "node", "runtime-manifest.json"]) {
    rmSync(join(runtimeRoot, name), { recursive: true, force: true });
  }
  const bundledModules = join(runtimeRoot, "node_modules");
  cpSync(deployedModules, bundledModules, {
    recursive: true,
  });
  makeSymlinksPortable(bundledModules, realpathSync(deployedModules), bundledModules);

  const bundledNode = process.platform === "win32"
    ? join(runtimeRoot, "node", "node.exe")
    : join(runtimeRoot, "node", "bin", "node");
  mkdirSync(dirname(bundledNode), { recursive: true });
  cpSync(process.execPath, bundledNode);

  const nodeLicense = resolve(nodeBinDir, "..", "LICENSE");
  if (existsSync(nodeLicense)) {
    cpSync(nodeLicense, join(runtimeRoot, "node", "LICENSE"));
  }

  const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  writeFileSync(
    join(runtimeRoot, "runtime-manifest.json"),
    `${JSON.stringify({
      schema: 1,
      platform: platformKey,
      node: nodeVersion,
      harness: packageJson.dependencies["@deepseek-ai/dsh"],
    }, null, 2)}\n`,
  );

  console.log(`Prepared ${platformKey} runtime at ${runtimeRoot}`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
