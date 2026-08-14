import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const platform = process.argv[2];
if (!new Set(["macos", "windows", "linux"]).has(platform)) {
  throw new Error("Usage: node scripts/check-release-env.mjs <macos|windows|linux>");
}

const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
const expectedTag = `v${packageJson.version}`;
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== expectedTag) {
  throw new Error(`Release tag ${process.env.GITHUB_REF_NAME} must match package version ${expectedTag}`);
}

const required = platform === "macos"
  ? [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_API_KEY",
      "APPLE_API_ISSUER",
    ]
  : platform === "windows"
    ? ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD"]
    : [];
const missing = required.filter((name) => !process.env[name]);
if (platform === "macos" && !process.env.APPLE_API_KEY_CONTENT && !process.env.APPLE_API_KEY_PATH) {
  missing.push("APPLE_API_KEY_CONTENT or APPLE_API_KEY_PATH");
}
if (missing.length > 0) {
  throw new Error(`${platform} release is blocked: missing ${missing.join(", ")}`);
}
console.log(`${platform} release credentials and version gate passed.`);
