import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const bundleRoot = join(projectRoot, "src-tauri", "target", "release", "bundle");
const appPath = join(bundleRoot, "macos", "DSH Desk.app");
const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
const dmgName = `DSH Desk_${packageJson.version}_${architecture}.dmg`;
const dmgPath = join(bundleRoot, "dmg", dmgName);
const stagingRoot = mkdtempSync(join(tmpdir(), "dsh-desk-dmg-"));

if (process.platform !== "darwin") {
  throw new Error("The macOS release packager must run on macOS");
}
if (!appPath.endsWith(["bundle", "macos", "DSH Desk.app"].join(sep)) || !existsSync(appPath)) {
  throw new Error(`Built application is missing: ${appPath}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
}

try {
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

  mkdirSync(dirname(dmgPath), { recursive: true });
  const stagedApp = join(stagingRoot, "DSH Desk.app");
  run("ditto", [appPath, stagedApp]);
  symlinkSync("/Applications", join(stagingRoot, "Applications"));
  run("hdiutil", [
    "create",
    "-volname",
    "DSH Desk",
    "-srcfolder",
    stagingRoot,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(dmgPath)) {
    hash.update(chunk);
  }
  const checksum = `${hash.digest("hex")}  ${basename(dmgPath)}\n`;
  writeFileSync(`${dmgPath}.sha256`, checksum);
  console.log(`Packaged ${dmgPath}`);
  console.log(checksum.trim());
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
