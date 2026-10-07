import assert from "node:assert/strict";

const repository = "majiayu000/dsh-desk";
const github = `https://github.com/${repository}`;
const timestamp = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const success = (value) => value?.status === "completed" && value.conclusion === "success";

export function validateEvidence(evidence) {
  const { release, build, workflow } = evidence;
  assert.equal(evidence.schemaVersion, 1, "Unsupported release evidence schema");
  assert.ok(timestamp(evidence.observedAt), "Evidence observation timestamp is required");
  assert.equal(release.draft, false, "Draft releases cannot be advertised as published");
  assert.ok(timestamp(release.published_at), "Release publication timestamp is required");
  assert.ok(Date.parse(release.published_at) <= Date.parse(evidence.observedAt), "Observation predates publication");
  assert.match(build.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Invalid tagged build version");
  assert.match(build.harnessVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Harness version must be pinned");
  assert.match(build.commit, /^[0-9a-f]{40}$/, "Exact tagged source commit is required");
  assert.equal(release.tag_name, `v${build.version}`, "Release tag must match tagged package.json");
  assert.equal(release.html_url, `${github}/releases/tag/${release.tag_name}`, "Unexpected release URL");
  assert.equal(workflow.head_sha, build.commit, "Release workflow must match the tagged source commit");
  assert.ok(Number.isSafeInteger(workflow.id) && workflow.id > 0, "Invalid release workflow ID");
  assert.ok(Array.isArray(workflow.jobs), "Release job evidence is required (may be empty)");
  const names = new Set();
  assert.ok(Array.isArray(release.assets), "Release assets must be recorded (may be empty)");
  for (const asset of release.assets) {
    assert.ok(!names.has(asset.name), `Duplicate release asset: ${asset.name}`);
    names.add(asset.name);
    assert.ok(asset.name === "latest.json" || asset.name.startsWith(`DSH.Desk_${build.version}_`), `Asset version does not match tag: ${asset.name}`);
    assert.equal(asset.browser_download_url, `${github}/releases/download/${release.tag_name}/${encodeURIComponent(asset.name)}`, `Unexpected asset URL: ${asset.name}`);
  }
  const jobs = new Set();
  for (const job of workflow.jobs) {
    assert.ok(!jobs.has(job.name), `Duplicate release job: ${job.name}`);
    jobs.add(job.name);
    assert.ok(job.html_url.startsWith(`${github}/actions/runs/${workflow.id}/job/`), "Job evidence must belong to the release run");
  }
  return evidence;
}

export function renderRelease(evidence, language = "en") {
  validateEvidence(evidence);
  const { release, build, workflow } = evidence;
  const zh = language === "zh";
  const asset = (suffix) => release.assets.find((entry) => entry.name === `DSH.Desk_${build.version}_${suffix}` && entry.state === "uploaded");
  const link = (suffix, label) => {
    const item = asset(suffix);
    return item ? `[${label}](${item.browser_download_url})` : (zh ? `${label}：无已记录资产` : `${label}: no recorded asset`);
  };
  const verifiedStep = (jobName, stepName) => success(workflow) && workflow.jobs.some((job) => job.name === jobName && success(job) && job.steps?.some((step) => step.name === stepName && success(step)));
  const macSigning = (job) => verifiedStep(job, "Verify notarized macOS distribution")
    ? (zh ? "发布 CI 已通过 Developer ID / 公证 / staple 检查" : "Release CI passed Developer ID / notarization / staple checks")
    : (zh ? "系统签名证据未知" : "System signing evidence unknown");
  const updater = (suffixes) => {
    const present = suffixes.every((suffix) => asset(suffix) && asset(`${suffix}.sig`));
    if (!present) return zh ? "updater 签名证据不完整" : "Updater signature evidence incomplete";
    return verifiedStep("Publish verified update channel / validate", "Validate assets, signatures, and monotonic version")
      ? (zh ? "updater 验签已通过发布 CI" : "Updater verification passed release CI")
      : (zh ? "含 updater 签名资产；验签状态未知" : "Updater signature assets recorded; verification unknown");
  };
  const unsigned = release.windows_signing_notice?.includes("The Windows installer is an unsigned alpha build");
  const windows = unsigned ? (zh ? "Alpha 未做 Authenticode 签名（SmartScreen 提示）" : "Unsigned alpha (SmartScreen notice)") : (zh ? "Authenticode 状态未知" : "Authenticode status unknown");
  const releaseLink = `[\`${release.tag_name}\`](${release.html_url})`;
  const rows = [
    ["macOS Apple Silicon", link("aarch64.dmg", "DMG"), macSigning("macos-arm64 release bundle")],
    ["macOS Intel", link("x64.dmg", "DMG"), macSigning("macos-x64 release bundle")],
    ["Windows x64", link("x64-setup.exe", "NSIS"), `${windows}${zh ? "；" : "; "}${updater(["x64-setup.exe"])}`],
    ["Linux x64", `${link("amd64.AppImage", "AppImage")} / ${link("amd64.deb", "deb")}`, updater(["amd64.AppImage", "amd64.deb"])],
  ];
  const source = `${github}/blob/${build.commit}/package.json`;
  const run = `${github}/actions/runs/${workflow.id}`;
  return [
    zh ? `已记录的公开版本：${releaseLink}，发布于 ${release.published_at}。` : `Recorded public release: ${releaseLink}, published ${release.published_at}.`,
    "",
    zh ? "| 平台 | 已记录下载资产 | 签名证据 |" : "| Platform | Recorded download assets | Signing evidence |",
    "|---|---|---|",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
    zh
      ? `发布版本的 [package.json](${source}) 固定 DSH Desk \`${build.version}\` 与 Harness \`${build.harnessVersion}\`。[发布运行](${run})：\`${workflow.status}/${workflow.conclusion ?? "unknown"}\`。`
      : `The release's [package.json](${source}) pins DSH Desk \`${build.version}\` with Harness \`${build.harnessVersion}\`. [Release run](${run}): \`${workflow.status}/${workflow.conclusion ?? "unknown"}\`.`,
    "",
    zh
      ? `证据观察时间：${evidence.observedAt}。此表检查已保存的公开元数据；不代表本次独立下载验签，也不保证资产持续在线。updater 签名不能证明 Windows Authenticode 身份。`
      : `Evidence observed ${evidence.observedAt}. This table checks saved public metadata; it is not an independent download/signature verification or a guarantee of continued availability. Updater signing does not establish Windows Authenticode identity.`,
  ].join("\n");
}

export function renderBuild(packageJson, language = "en") {
  const version = packageJson.version;
  const harness = packageJson.dependencies["@deepseek-ai/dsh"];
  return language === "zh"
    ? `本仓库开发版本：DSH Desk \`${version}\` × Harness \`${harness}\`（来自当前 \`package.json\`；公开下载以已发布证据为准）。`
    : `Repository development version: DSH Desk \`${version}\` × Harness \`${harness}\` (from current \`package.json\`; published downloads follow the release evidence).`;
}

export function replaceBlock(source, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  assert.equal(source.split(start).length, 2, `Expected one ${start}`);
  assert.equal(source.split(end).length, 2, `Expected one ${end}`);
  const from = source.indexOf(start) + start.length;
  const to = source.indexOf(end);
  assert.ok(from <= to, `Reversed ${name} markers`);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r?\n/g, newline);
  return `${source.slice(0, from)}${newline}${normalized}${newline}${source.slice(to)}`;
}
