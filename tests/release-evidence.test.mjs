import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { renderBuild, renderRelease, replaceBlock, validateEvidence } from "../scripts/lib/release-evidence.mjs";

const recordedEvidence = JSON.parse(readFileSync(new URL("../docs/release-evidence.json", import.meta.url), "utf8"));
const github = "https://github.com/majiayu000/dsh-desk";
const evidence = {
  schemaVersion: 1,
  observedAt: "2026-01-02T00:00:00Z",
  release: {
    tag_name: "v1.2.3-alpha.1", draft: false, published_at: "2026-01-01T00:00:00Z",
    html_url: `${github}/releases/tag/v1.2.3-alpha.1`,
    windows_signing_notice: "The Windows installer is an unsigned alpha build",
    assets: ["aarch64.dmg", "x64.dmg", "x64-setup.exe", "x64-setup.exe.sig", "amd64.AppImage", "amd64.AppImage.sig", "amd64.deb", "amd64.deb.sig"].map((suffix) => ({
      name: `DSH.Desk_1.2.3-alpha.1_${suffix}`, state: "uploaded",
      browser_download_url: `${github}/releases/download/v1.2.3-alpha.1/DSH.Desk_1.2.3-alpha.1_${suffix}`,
    })),
  },
  build: { commit: "a".repeat(40), version: "1.2.3-alpha.1", harnessVersion: "1.2.0" },
  workflow: {
    id: 123, head_sha: "a".repeat(40), status: "completed", conclusion: "success",
    jobs: ["macos-arm64 release bundle", "macos-x64 release bundle", "Publish verified update channel / validate"].map((name, index) => ({
      name, html_url: `${github}/actions/runs/123/job/${index + 1}`, status: "completed", conclusion: "success",
      steps: [{ name: name.startsWith("macos") ? "Verify notarized macOS distribution" : "Validate assets, signatures, and monotonic version", status: "completed", conclusion: "success" }],
    })),
  },
};
const fixture = () => structuredClone(evidence);

test("recorded public release renders the same tag and asset links in both languages", () => {
  for (const language of ["en", "zh"]) {
    const output = renderRelease(evidence, language);
    assert.ok(output.includes(evidence.release.html_url));
    for (const suffix of ["aarch64.dmg", "x64.dmg", "x64-setup.exe", "amd64.AppImage", "amd64.deb"]) {
      assert.ok(output.includes(`_${suffix}`));
    }
    assert.ok(output.includes(evidence.observedAt));
    assert.ok(output.includes(evidence.build.commit));
  }
});

test("draft, unpublished, and mismatched release metadata fail closed", () => {
  for (const [change, message] of [
    [(e) => { e.release.draft = true; }, /Draft/],
    [(e) => { e.release.published_at = null; }, /publication timestamp/],
    [(e) => { e.observedAt = "2020-01-01T00:00:00Z"; }, /predates/],
    [(e) => { e.release.tag_name = "v0.1.0-alpha.13"; }, /match tagged/],
    [(e) => { e.build.harnessVersion = "latest"; }, /pinned/],
    [(e) => { e.workflow.head_sha = "0".repeat(40); }, /tagged source/],
    [(e) => { e.release.html_url += "-different"; }, /Unexpected release URL/],
    [(e) => { e.release.assets[0].browser_download_url += "?wrong"; }, /Unexpected asset URL/],
    [(e) => { e.release.assets[0].name = "DSH.Desk_0.0.0_aarch64.dmg"; }, /Asset version/],
    [(e) => { e.release.assets.push(e.release.assets[0]); }, /Duplicate/],
    [(e) => { e.workflow.jobs.push(e.workflow.jobs[0]); }, /Duplicate release job/],
  ]) {
    const copy = fixture();
    change(copy);
    assert.throws(() => validateEvidence(copy), message);
  }
});

test("missing or unuploaded installers never produce a download link", () => {
  for (const state of ["missing", "uploading"]) {
    const copy = fixture();
    const target = copy.release.assets.find((a) => a.name.endsWith("_aarch64.dmg"));
    if (state === "missing") copy.release.assets = copy.release.assets.filter((a) => a !== target);
    else target.state = state;
    const output = renderRelease(copy);
    assert.ok(!output.includes(`](${target.browser_download_url})`));
    assert.match(output, /DMG: no recorded asset/);
  }
});

test("failed, absent, pending, or skipped workflow evidence never becomes verified signing", () => {
  for (const change of [
    (e) => { e.workflow.conclusion = "failure"; },
    (e) => { e.workflow.status = "in_progress"; e.workflow.conclusion = null; },
    (e) => { e.workflow.jobs = []; },
    (e) => { for (const job of e.workflow.jobs) job.steps[0].conclusion = "skipped"; },
  ]) {
    const copy = fixture(); change(copy);
    const output = renderRelease(copy);
    assert.match(output, /System signing evidence unknown/);
    assert.match(output, /verification unknown/);
    assert.doesNotMatch(output, /passed release CI|Release CI passed/);
  }
});

test("signature sidecar presence and updater success never imply Authenticode signing", () => {
  const copy = fixture();
  assert.match(renderRelease(copy), /Unsigned alpha/);
  copy.release.windows_signing_notice = "";
  assert.match(renderRelease(copy), /Authenticode status unknown/);
  copy.release.assets = copy.release.assets.filter((a) => !a.name.endsWith(".exe.sig"));
  assert.match(renderRelease(copy), /Updater signature evidence incomplete/);
});

test("an unreleased checkout version stays distinct from the observed release", () => {
  const next = { version: "0.2.0-alpha.1", dependencies: { "@deepseek-ai/dsh": "0.2.0-rc.1" } };
  assert.match(renderBuild(next), /0.2.0-alpha.1/);
  assert.doesNotMatch(renderRelease(evidence), /0.2.0-alpha.1/);
});

test("generation is idempotent, repairs current drift, and preserves historical evidence", () => {
  const before = "Current\n<!-- release-evidence:start -->\nalpha.13\n<!-- release-evidence:end -->\nHistory: alpha.12 run 31999103490\n";
  const generated = replaceBlock(before, "release-evidence", renderRelease(evidence));
  assert.ok(!generated.includes("alpha.13"));
  assert.ok(generated.endsWith("History: alpha.12 run 31999103490\n"));
  assert.equal(replaceBlock(generated, "release-evidence", renderRelease(evidence)), generated);
});

test("missing, duplicate, or reversed markers fail rather than hiding documentation drift", () => {
  for (const input of ["", "<!-- release-evidence:start --><!-- release-evidence:start --><!-- release-evidence:end -->", "<!-- release-evidence:end --><!-- release-evidence:start -->"]) {
    assert.throws(() => replaceBlock(input, "release-evidence", "content"));
  }
});

for (const [lineEnding, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
test(`offline CLI rejects stale docs and repairs them idempotently (${lineEnding})`, () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-release-evidence-"));
  try {
    for (const file of ["scripts/release-evidence.mjs", "scripts/lib/release-evidence.mjs", "docs/release-evidence.json", "package.json", "README.md", "README.en.md", "docs/compatibility.md"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      if (file.endsWith(".md")) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
        writeFileSync(join(root, file), source.replace(/\r?\n/g, newline));
      } else {
        copyFileSync(new URL(`../${file}`, import.meta.url), join(root, file));
      }
    }
    const readme = join(root, "README.md");
    const original = readFileSync(readme, "utf8");
    writeFileSync(readme, original.replace(recordedEvidence.release.tag_name, "v0.0.0-stale"));
    const run = (...args) => spawnSync(process.execPath, [join(root, "scripts/release-evidence.mjs"), ...args], { encoding: "utf8" });
    const stale = run();
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /README.md: release evidence drift/);
    assert.equal(run("--write").status, 0);
    assert.equal(readFileSync(readme, "utf8"), original);
    assert.equal(run().status, 0);
    assert.equal(run("--write").status, 0);
    assert.equal(readFileSync(readme, "utf8"), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
}
