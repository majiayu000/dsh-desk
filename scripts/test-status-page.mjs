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
const robots = readFileSync(resolve(projectRoot, "site/robots.txt"), "utf8");
const sitemap = readFileSync(resolve(projectRoot, "site/sitemap.xml"), "utf8");
const script = readFileSync(resolve(projectRoot, "site/status.js"), "utf8");
const workflow = readFileSync(resolve(projectRoot, ".github/workflows/pages.yml"), "utf8");

for (const marker of ["data-overall", "data-platform=\"macos\"", "data-platform=\"windows\"", "data-platform=\"linux\"", "data-candidate", "data-ci"]) {
  assert.ok(html.includes(marker), `status page is missing ${marker}`);
}
assert.ok(script.includes("api.github.com/repos/"), "status page does not use public GitHub evidence");
assert.ok(html.includes('hreflang="zh-CN"'), "English page does not link to the Chinese page");
assert.ok(chineseHtml.includes('<html lang="zh-CN">'), "Chinese page does not declare its language");
assert.ok(chineseHtml.includes('hreflang="en"'), "Chinese page does not link to the English page");
assert.ok(robots.includes("Sitemap: https://www.dshdesk.com/sitemap.xml"), "robots.txt does not advertise the canonical sitemap");
for (const url of ["https://www.dshdesk.com/", "https://www.dshdesk.com/zh-CN/"]) {
  assert.ok(sitemap.includes(`<loc>${url}</loc>`), `sitemap is missing ${url}`);
}
for (const marker of ["data-overall", "data-platform=\"macos\"", "data-platform=\"windows\"", "data-platform=\"linux\"", "data-candidate", "data-ci"]) {
  assert.ok(chineseHtml.includes(marker), `Chinese status page is missing ${marker}`);
}
assert.ok(script.includes("document.documentElement.lang"), "status copy is not localized by page language");
assert.ok(workflow.includes("actions/deploy-pages@v5"), "Pages workflow does not deploy the site");

class FakeElement {
  constructor(children = {}) {
    this.children = children;
    this.dataset = {};
    this.textContent = "";
    this.href = "fallback";
  }

  querySelector(selector) {
    return this.children[selector];
  }

  removeAttribute(name) {
    if (name === "href") delete this.href;
  }
}

function stateCard() {
  return new FakeElement({
    "[data-status]": new FakeElement(),
    "[data-detail]": new FakeElement(),
    a: new FakeElement(),
  });
}

function radarDocument(lang) {
  const overall = new FakeElement({
    "[data-overall-label]": new FakeElement(),
    "[data-overall-message]": new FakeElement(),
    a: new FakeElement(),
  });
  const platforms = {
    macos: stateCard(),
    windows: stateCard(),
    linux: stateCard(),
  };
  const candidate = stateCard();
  const ci = stateCard();
  const updated = new FakeElement();
  const desktopVersions = [new FakeElement(), new FakeElement()];
  const harnessVersions = [new FakeElement(), new FakeElement()];
  const selectors = new Map([
    ["[data-overall]", overall],
    ['[data-platform="macos"]', platforms.macos],
    ['[data-platform="windows"]', platforms.windows],
    ['[data-platform="linux"]', platforms.linux],
    ["[data-candidate]", candidate],
    ["[data-ci]", ci],
    ["[data-updated]", updated],
  ]);

  return {
    document: {
      documentElement: { lang },
      querySelector: (selector) => selectors.get(selector),
      querySelectorAll: (selector) => {
        if (selector === "[data-desktop-version]") return desktopVersions;
        if (selector === "[data-harness-version]") return harnessVersions;
        return [];
      },
    },
    refs: { overall, platforms, candidate, ci, updated, desktopVersions, harnessVersions },
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

async function renderScenario(name, lang, fetchImplementation) {
  const { document, refs } = radarDocument(lang);
  globalThis.document = document;
  globalThis.fetch = fetchImplementation;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: lang },
  });
  const moduleUrl = new URL("../site/status.js", import.meta.url);
  moduleUrl.searchParams.set("scenario", name);
  const { radarReady } = await import(moduleUrl.href);
  await radarReady;
  return refs;
}

const compatibilityRun = {
  id: 101,
  status: "completed",
  conclusion: "success",
  updated_at: "2026-08-15T02:00:00Z",
  html_url: "https://example.test/compatibility/101",
};
const ciRun = {
  id: 202,
  status: "completed",
  conclusion: "success",
  head_sha: "abcdef0123456789",
  html_url: "https://example.test/ci/202",
};
const successfulJobs = [
  "macOS-arm64 contract",
  "Windows-x64 contract",
  "Linux-x64 contract",
  "npm latest candidate",
].map((name, index) => ({
  name,
  status: "completed",
  conclusion: "success",
  html_url: `https://example.test/jobs/${index}`,
}));

function successfulFetch(url) {
  if (url.includes("compatibility.yml/runs")) return jsonResponse({ workflow_runs: [compatibilityRun] });
  if (url.includes("ci.yml/runs")) return jsonResponse({ workflow_runs: [ciRun] });
  if (url.includes("/actions/runs/101/jobs")) return jsonResponse({ jobs: successfulJobs });
  if (url.endsWith("/package.json")) {
    return jsonResponse({ version: "0.1.0-test", dependencies: { "@deepseek-ai/dsh": "0.1.0-rc.test" } });
  }
  if (url.endsWith("/src/plugin-catalog.json")) {
    return jsonResponse({ desktopVersion: "catalog-desktop", harnessVersion: "catalog-harness" });
  }
  throw new Error(`Unexpected test URL: ${url}`);
}

const successfulEnglish = await renderScenario("successful-english", "en", successfulFetch);
assert.equal(successfulEnglish.overall.dataset.state, "verified");
assert.equal(successfulEnglish.overall.querySelector("[data-overall-label]").textContent, "VERIFIED");
assert.equal(successfulEnglish.platforms.windows.querySelector("[data-detail]").textContent, "Windows-x64 contract");
assert.equal(successfulEnglish.candidate.querySelector("a").href, "https://example.test/jobs/3");
assert.equal(successfulEnglish.ci.querySelector("[data-detail]").textContent, "Commit abcdef0");
assert.equal(successfulEnglish.desktopVersions[0].textContent, "0.1.0-test");
assert.equal(successfulEnglish.harnessVersions[0].textContent, "0.1.0-rc.test");
assert.match(successfulEnglish.updated.textContent, /2026/);

const missingChinese = await renderScenario("missing-chinese", "zh-CN", (url) => {
  if (url.includes("/actions/workflows/")) return jsonResponse({ workflow_runs: [] });
  if (url.endsWith("/package.json")) return jsonResponse({ version: "0.1.0-test", dependencies: {} });
  if (url.endsWith("/src/plugin-catalog.json")) return jsonResponse({ harnessVersion: "0.1.0-rc.test" });
  throw new Error(`Unexpected test URL: ${url}`);
});
assert.equal(missingChinese.overall.querySelector("[data-overall-label]").textContent, "未知");
assert.equal(missingChinese.platforms.macos.querySelector("[data-detail]").textContent, "未找到对应的平台验证记录");
assert.equal(missingChinese.updated.textContent, "尚未报告");
assert.ok(!missingChinese.updated.textContent.includes("Not yet"));

const failedJobs = await renderScenario("failed-jobs", "en", (url) => {
  if (url.includes("/actions/runs/101/jobs")) return jsonResponse({}, 503);
  return successfulFetch(url);
});
assert.equal(failedJobs.overall.dataset.state, "verified");
assert.equal(failedJobs.platforms.windows.dataset.state, "unknown");
assert.equal(failedJobs.platforms.windows.querySelector("[data-detail]").textContent, "No job evidence found");

const totalFailure = await renderScenario(
  "total-fetch-failure",
  "zh-CN",
  () => jsonResponse({ message: "upstream unavailable" }, 503),
);
assert.equal(totalFailure.overall.dataset.state, "unknown");
assert.equal(totalFailure.overall.querySelector("[data-overall-message]").textContent, "暂时无法加载公开验证记录。");
assert.equal(totalFailure.desktopVersions[0].textContent, "暂无数据");
assert.equal(totalFailure.updated.textContent, "尚未报告");

const originalConsoleError = console.error;
const loggedErrors = [];
console.error = (...values) => loggedErrors.push(values);
try {
  const malformedCi = await renderScenario("localized-error", "zh-CN", (url) => {
    if (url.includes("ci.yml/runs")) {
      return jsonResponse({ workflow_runs: [{ ...ciRun, head_sha: null }] });
    }
    return successfulFetch(url);
  });
  assert.equal(malformedCi.overall.dataset.state, "unknown");
  assert.equal(malformedCi.overall.querySelector("[data-overall-message]").textContent, "暂时无法加载公开验证记录。");
  assert.equal(loggedErrors.length, 1);
} finally {
  console.error = originalConsoleError;
}

console.log(JSON.stringify({
  signals: [
    {
      signal_type: "compatibility_radar_contract",
      signal: { status: "passed", states: ["verified", "blocked", "checking", "unknown"] },
      reason: "Status derivation, localized rendering, failure fallbacks, and Pages deployment contract are verified.",
    },
  ],
}, null, 2));
