export function workflowState(run) {
  if (!run) return "unknown";
  if (run.status !== "completed") return "checking";
  return run.conclusion === "success" ? "verified" : "blocked";
}

export function jobState(job) {
  if (!job) return "unknown";
  if (job.status !== "completed") return "checking";
  if (job.conclusion === "success" || job.conclusion === "skipped") return "verified";
  return "blocked";
}

export function overallState(compatibilityRun, ciRun) {
  const states = [workflowState(compatibilityRun), workflowState(ciRun)];
  if (states.includes("blocked")) return "blocked";
  if (states.includes("checking")) return "checking";
  if (workflowState(compatibilityRun) === "verified") return "verified";
  return "unknown";
}

export function findJob(jobs, fragment) {
  const lowered = fragment.toLowerCase();
  return jobs.find((job) => job.name.toLowerCase().includes(lowered));
}

export function formatTimestamp(value, locale = "en") {
  if (!value) return "Not yet reported";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not yet reported";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}
