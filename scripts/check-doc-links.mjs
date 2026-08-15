import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const markdownFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
  {
    cwd: projectRoot,
    encoding: "utf8",
  },
)
  .trim()
  .split("\n")
  .filter(Boolean);

const failures = [];
const linkPattern = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

for (const relativeFile of markdownFiles) {
  const absoluteFile = resolve(projectRoot, relativeFile);
  const source = readFileSync(absoluteFile, "utf8");

  for (const match of source.matchAll(linkPattern)) {
    const destination = match[1];
    if (
      destination.startsWith("#") ||
      destination.startsWith("http://") ||
      destination.startsWith("https://") ||
      destination.startsWith("mailto:")
    ) {
      continue;
    }

    const pathOnly = decodeURIComponent(destination.split("#", 1)[0]);
    if (!pathOnly) continue;

    const resolved = resolve(dirname(absoluteFile), pathOnly);
    if (!existsSync(resolved)) {
      failures.push(`${relativeFile}: missing local link target ${destination}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const result = {
  signals: [
    {
      signal_type: "documentation_links",
      signal: {
        markdown_files: markdownFiles.length,
        status: "passed",
      },
      reason: "Every relative Markdown link resolves to a tracked workspace target.",
    },
  ],
};

console.log(JSON.stringify(result, null, 2));
