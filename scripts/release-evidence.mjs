import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderBuild, renderRelease, replaceBlock } from "./lib/release-evidence.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--write")) {
  throw new Error("Usage: node scripts/release-evidence.mjs [--write]");
}
const evidence = JSON.parse(readFileSync(resolve(root, "docs/release-evidence.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
let drift = false;
for (const [path, language] of [["README.en.md", "en"], ["README.md", "zh"], ["docs/compatibility.md", "zh"]]) {
  const file = resolve(root, path);
  const before = readFileSync(file, "utf8");
  const after = replaceBlock(replaceBlock(before, "release-evidence", renderRelease(evidence, language)), "build-versions", renderBuild(packageJson, language));
  if (after !== before) {
    if (args.includes("--write")) writeFileSync(file, after);
    else { console.error(`${path}: release evidence drift; run pnpm docs:release-evidence`); drift = true; }
  }
}
if (drift) process.exitCode = 1;
else console.log("Release evidence documentation is consistent (offline check).");
