import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
const pinned = packageJson.dependencies["@deepseek-ai/dsh"];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pinned)) {
  throw new Error(`@deepseek-ai/dsh must be an exact version, got ${pinned}`);
}

const response = await fetch("https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest", {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
const metadata = await response.json();
const latest = metadata.version;
if (typeof latest !== "string" || latest.length === 0) {
  throw new Error("npm registry response did not include a latest version");
}

const report = { pinned, latest, drift: pinned !== latest };
console.log(JSON.stringify(report));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `pinned=${pinned}\nlatest=${latest}\ndrift=${report.drift}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## DeepSeek Harness version\n\n| Pinned | npm latest | Drift |\n|---|---|---|\n| \`${pinned}\` | \`${latest}\` | ${report.drift ? "yes" : "no"} |\n`,
  );
}
