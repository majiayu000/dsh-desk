import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const projectRoot = resolve(import.meta.dirname, "..");
const runtimeRootIndex = process.argv.indexOf("--runtime-root");
const runtimeRoot = runtimeRootIndex === -1
  ? null
  : resolve(projectRoot, process.argv[runtimeRootIndex + 1] ?? "");

const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const expectedVersion = packageJson.dependencies["@deepseek-ai/dsh"];
const node = runtimeRoot
  ? join(runtimeRoot, "node", process.platform === "win32" ? "node.exe" : "bin/node")
  : process.execPath;
const entry = runtimeRoot
  ? join(runtimeRoot, "node_modules/@deepseek-ai/dsh/lib/bin.js")
  : join(projectRoot, "node_modules/@deepseek-ai/dsh/lib/bin.js");
const toolBin = runtimeRoot
  ? join(runtimeRoot, "tools/bin")
  : join(projectRoot, "node_modules/.bin");
const home = mkdtempSync(join(tmpdir(), "dsh-desk-contract-"));
const timeoutMs = Number(process.env.DSH_CONTRACT_TIMEOUT_MS ?? 45_000);

function fail(message) {
  throw new Error(`Harness contract failed: ${message}`);
}

function verifyVersion() {
  const result = spawnSync(node, [entry, "--version"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DSH_HOME: home,
      PATH: `${toolBin}${delimiter}${process.env.PATH ?? ""}`,
      NO_COLOR: "1",
    },
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`--version exited ${result.status}: ${result.stderr}`);
  const actualVersion = result.stdout.trim();
  if (actualVersion !== expectedVersion) {
    fail(`package.json pins ${expectedVersion}, executable reports ${actualVersion}`);
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGINT");
  } catch {
    child.kill("SIGINT");
  }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function waitForHealthyUrl(child) {
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-12_000);
  });

  const readyUrl = new Promise((resolveUrl, rejectUrl) => {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (!line.startsWith("dsh web: ")) return;
      const value = line.slice("dsh web: ".length).split(/\s/, 1)[0];
      let url;
      try {
        url = new URL(value);
      } catch {
        rejectUrl(new Error(`runtime printed an invalid URL: ${value}`));
        return;
      }
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
        rejectUrl(new Error(`runtime escaped strict loopback policy: ${value}`));
        return;
      }
      resolveUrl(url);
    });
    child.once("error", rejectUrl);
    child.once("exit", (code, signal) => {
      rejectUrl(new Error(`runtime exited before ready (${code ?? signal})\n${stderr}`));
    });
  });

  const timeout = new Promise((_, rejectTimeout) => {
    setTimeout(() => rejectTimeout(new Error(`runtime did not become ready in ${timeoutMs}ms\n${stderr}`)), timeoutMs);
  });
  const url = await Promise.race([readyUrl, timeout]);

  const deadline = Date.now() + 10_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.status === 200 && (await response.text()).length > 0) return url;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  fail(`runtime reported ready but health check failed: ${lastError}`);
}

let child;
try {
  verifyVersion();
  child = spawn(node, [entry, "web", "--host", "127.0.0.1", "--port", "0"], {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DSH_HOME: home,
      PATH: `${toolBin}${delimiter}${process.env.PATH ?? ""}`,
      NO_COLOR: "1",
    },
  });
  const url = await waitForHealthyUrl(child);
  console.log(JSON.stringify({
    status: "compatible",
    harness: expectedVersion,
    carrier: runtimeRoot ? "packaged-runtime" : "development",
    origin: url.origin,
  }));
} finally {
  if (child) await stopProcess(child);
  rmSync(home, { recursive: true, force: true });
}
