import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { walkFiles } from "./lib/files.mjs";

const bundleRoot = resolve(import.meta.dirname, "../src-tauri/target/release/bundle");
const releaseExtensions = new Set([".dmg", ".exe", ".msi", ".appimage", ".deb", ".rpm"]);

const artifacts = walkFiles(bundleRoot).filter(
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
