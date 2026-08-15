import { assembleUpdateManifest, stageReleaseArtifacts } from "./lib/release-artifacts.mjs";

const [command, ...args] = process.argv.slice(2);

if (command === "stage") {
  const [platform, bundleRoot, outputDirectory] = args;
  if (!platform || !bundleRoot || !outputDirectory) {
    throw new Error(
      "Usage: node scripts/release-artifacts.mjs stage <macos|windows|linux> <bundle-root> <output-directory>",
    );
  }
  const staged = stageReleaseArtifacts(platform, bundleRoot, outputDirectory);
  console.log(`Staged ${staged.length} ${platform} release artifacts.`);
} else if (command === "manifest") {
  const [artifactDirectory, version, tag] = args;
  if (!artifactDirectory || !version || !tag) {
    throw new Error(
      "Usage: node scripts/release-artifacts.mjs manifest <artifact-directory> <version> <tag>",
    );
  }
  const { manifest, output } = assembleUpdateManifest({
    artifactDirectory,
    version,
    tag,
    repository: process.env.GITHUB_REPOSITORY,
    notes: process.env.DSH_RELEASE_NOTES,
    pubDate: process.env.DSH_RELEASE_PUB_DATE,
  });
  console.log(
    `Wrote ${output} for ${Object.keys(manifest.platforms).length} updater targets.`,
  );
} else {
  throw new Error("Usage: node scripts/release-artifacts.mjs <stage|manifest> ...");
}
