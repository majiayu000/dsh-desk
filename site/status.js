import {
  findJob,
  formatTimestamp,
  jobState,
  overallState,
  workflowState,
} from "./status-lib.mjs";

const repository = "majiayu000/dsh-desk";
const apiRoot = `https://api.github.com/repos/${repository}`;
const rawRoot = `https://raw.githubusercontent.com/${repository}/main`;

const stateCopy = {
  verified: { label: "VERIFIED", message: "Pinned runtime checks are green." },
  blocked: { label: "BLOCKED", message: "A public verification check needs attention." },
  checking: { label: "CHECKING", message: "Verification is currently running." },
  unknown: { label: "UNKNOWN", message: "Live evidence could not be loaded." },
};

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return response.json();
}

async function latestRun(workflow) {
  const data = await fetchJson(`${apiRoot}/actions/workflows/${workflow}/runs?branch=main&per_page=1`);
  return data.workflow_runs?.[0] ?? null;
}

function setState(element, state, detail) {
  element.dataset.state = state;
  element.querySelector("[data-status]").textContent = stateCopy[state].label;
  if (detail) element.querySelector("[data-detail]").textContent = detail;
}

function renderPlatform(id, job) {
  const element = document.querySelector(`[data-platform="${id}"]`);
  const state = jobState(job);
  setState(element, state, job ? job.name : "No job evidence found");
  const link = element.querySelector("a");
  if (job?.html_url) link.href = job.html_url;
  else link.removeAttribute("href");
}

function renderVersion(packageData, catalogData) {
  const desktop = packageData?.version ?? catalogData?.desktopVersion ?? "Unavailable";
  const harness = packageData?.dependencies?.["@deepseek-ai/dsh"] ?? catalogData?.harnessVersion ?? "Unavailable";
  document.querySelector("[data-desktop-version]").textContent = desktop;
  document.querySelector("[data-harness-version]").textContent = harness;
}

async function loadRadar() {
  const results = await Promise.allSettled([
    latestRun("compatibility.yml"),
    latestRun("ci.yml"),
    fetchJson(`${rawRoot}/package.json`),
    fetchJson(`${rawRoot}/src/plugin-catalog.json`),
  ]);

  const compatibilityRun = results[0].status === "fulfilled" ? results[0].value : null;
  const ciRun = results[1].status === "fulfilled" ? results[1].value : null;
  const packageData = results[2].status === "fulfilled" ? results[2].value : null;
  const catalogData = results[3].status === "fulfilled" ? results[3].value : null;
  const runJobs = compatibilityRun
    ? await fetchJson(`${apiRoot}/actions/runs/${compatibilityRun.id}/jobs?per_page=100`).catch(() => ({ jobs: [] }))
    : { jobs: [] };

  const state = overallState(compatibilityRun, ciRun);
  const hero = document.querySelector("[data-overall]");
  hero.dataset.state = state;
  hero.querySelector("[data-overall-label]").textContent = stateCopy[state].label;
  hero.querySelector("[data-overall-message]").textContent = stateCopy[state].message;

  const evidenceLink = hero.querySelector("a");
  if (compatibilityRun?.html_url) evidenceLink.href = compatibilityRun.html_url;

  renderVersion(packageData, catalogData);
  renderPlatform("macos", findJob(runJobs.jobs, "macOS-arm64"));
  renderPlatform("windows", findJob(runJobs.jobs, "Windows-x64"));
  renderPlatform("linux", findJob(runJobs.jobs, "Linux-x64"));

  const candidateJob = findJob(runJobs.jobs, "npm latest candidate");
  const candidate = document.querySelector("[data-candidate]");
  setState(candidate, jobState(candidateJob), candidateJob?.name ?? "No candidate evidence found");
  if (candidateJob?.html_url) candidate.querySelector("a").href = candidateJob.html_url;

  const ci = document.querySelector("[data-ci]");
  setState(ci, workflowState(ciRun), ciRun ? `Commit ${ciRun.head_sha.slice(0, 7)}` : "No CI evidence found");
  if (ciRun?.html_url) ci.querySelector("a").href = ciRun.html_url;

  document.querySelector("[data-updated]").textContent = formatTimestamp(
    compatibilityRun?.updated_at,
    navigator.language,
  );
}

loadRadar().catch((error) => {
  const hero = document.querySelector("[data-overall]");
  hero.dataset.state = "unknown";
  hero.querySelector("[data-overall-label]").textContent = stateCopy.unknown.label;
  hero.querySelector("[data-overall-message]").textContent = `${stateCopy.unknown.message} ${error.message}`;
});
