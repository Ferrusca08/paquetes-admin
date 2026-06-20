/**
 * PackTrack — esbuild config for Lambda functions
 *
 * Bundles each handler into its own directory under dist/,
 * ready for Terraform's archive_file data source to zip.
 */
import { build } from "esbuild";
import { readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const FUNCTIONS_DIR = resolve(import.meta.dirname);
const DIST_DIR = join(FUNCTIONS_DIR, "dist");

// Each subdirectory with a handler.ts is a Lambda function
const entries = readdirSync(FUNCTIONS_DIR).filter((dir) => {
  if (dir === "node_modules" || dir === "dist" || dir === "shared") return false;
  const full = join(FUNCTIONS_DIR, dir);
  return (
    statSync(full).isDirectory() &&
    existsSync(join(full, "handler.ts"))
  );
});

console.log(`📦 Building ${entries.length} Lambda functions...`);

for (const entry of entries) {
  const outdir = join(DIST_DIR, entry);
  mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: [join(FUNCTIONS_DIR, entry, "handler.ts")],
    bundle: true,
    minify: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: join(outdir, "index.mjs"),
    external: [
      // AWS SDK v3 is available in the Lambda runtime
      "@aws-sdk/*",
    ],
    banner: {
      // Needed for ESM in Lambda
      js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
  });

  console.log(`  ✅ ${entry} → dist/${entry}/index.mjs`);
}

console.log("🎉 Build complete!");
