import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  findJob,
  formatTimestamp,
  jobState,
  overallState,
  workflowState,
} from "../site/status-lib.mjs";

const completed = { status: "completed", conclusion: "success" };
const failed = { status: "completed", conclusion: "failure" };

assert.equal(workflowState(completed), "verified");
assert.equal(workflowState({ status: "in_progress", conclusion: null }), "checking");
assert.equal(workflowState(failed), "blocked");
assert.equal(jobState({ status: "completed", conclusion: "skipped" }), "verified");
assert.equal(overallState(completed, completed), "verified");
assert.equal(overallState(completed, failed), "blocked");
assert.equal(overallState(null, completed), "unknown");
assert.equal(findJob([{ name: "Pinned (macOS-arm64)" }], "macos-arm64")?.name, "Pinned (macOS-arm64)");
assert.match(formatTimestamp("2026-08-15T02:00:00Z"), /2026/);

const projectRoot = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(projectRoot, "site/index.html"), "utf8");
const chineseHtml = readFileSync(resolve(projectRoot, "site/zh-CN/index.html"), "utf8");
const script = readFileSync(resolve(projectRoot, "site/status.js"), "utf8");
const workflow = readFileSync(resolve(projectRoot, ".github/workflows/pages.yml"), "utf8");

for (const marker of ["data-overall", "data-platform=\"macos\"", "data-platform=\"windows\"", "data-platform=\"linux\"", "data-candidate", "data-ci"]) {
  assert.ok(html.includes(marker), `status page is missing ${marker}`);
}
assert.ok(script.includes("api.github.com/repos/"), "status page does not use public GitHub evidence");
assert.ok(html.includes('hreflang="zh-CN"'), "English page does not link to the Chinese page");
assert.ok(chineseHtml.includes('<html lang="zh-CN">'), "Chinese page does not declare its language");
assert.ok(chineseHtml.includes('hreflang="en"'), "Chinese page does not link to the English page");
for (const marker of ["data-overall", "data-platform=\"macos\"", "data-platform=\"windows\"", "data-platform=\"linux\"", "data-candidate", "data-ci"]) {
  assert.ok(chineseHtml.includes(marker), `Chinese status page is missing ${marker}`);
}
assert.ok(script.includes("document.documentElement.lang"), "status copy is not localized by page language");
assert.ok(workflow.includes("actions/deploy-pages@v5"), "Pages workflow does not deploy the site");

console.log(JSON.stringify({
  signals: [
    {
      signal_type: "compatibility_radar_contract",
      signal: { status: "passed", states: ["verified", "blocked", "checking", "unknown"] },
      reason: "Status derivation, platform evidence hooks, and Pages deployment contract are present.",
    },
  ],
}, null, 2));
