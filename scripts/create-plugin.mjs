import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const [targetValue, packageName] = process.argv.slice(2);
if (!targetValue || !packageName) {
  throw new Error("Usage: pnpm create:plugin <target-directory> <package-name>");
}
if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
  throw new Error(`Invalid npm package name: ${packageName}`);
}

const target = resolve(process.cwd(), targetValue);
if (existsSync(target)) throw new Error(`Target already exists: ${target}`);
const template = resolve(projectRoot, "templates/dsh-plugin");
mkdirSync(target, { recursive: false });
cpSync(template, target, { recursive: true });

const manifestPath = resolve(target, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.name = packageName;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const readmePath = resolve(target, "README.md");
const readme = readFileSync(readmePath, "utf8")
  .replaceAll("@your-scope/dsh-plugin-example", packageName)
  .replaceAll("dsh-plugin-example", basename(target));
writeFileSync(readmePath, readme);
console.log(`Created ${packageName} at ${target}`);
