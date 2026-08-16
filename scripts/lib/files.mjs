import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name);
    return statSync(file).isDirectory() ? walkFiles(file) : [file];
  });
}
