import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const bundleRoot = resolve(import.meta.dirname, "../src-tauri/target/release/bundle");
const releaseExtensions = new Set([".dmg", ".exe", ".msi", ".appimage", ".deb", ".rpm"]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const artifacts = walk(bundleRoot).filter(
  (path) => releaseExtensions.has(extname(path).toLowerCase()) && !basename(path).startsWith("rw."),
);
if (artifacts.length === 0) throw new Error(`No release artifacts found under ${bundleRoot}`);

for (const artifact of artifacts) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  const checksum = `${hash.digest("hex")}  ${basename(artifact)}\n`;
  writeFileSync(`${artifact}.sha256`, checksum);
  console.log(checksum.trim());
}
