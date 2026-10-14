import { build } from "esbuild";
import { mkdir, cp, rm } from "node:fs/promises";
await mkdir("vendor", { recursive: true });
await build({
  stdin: {
    contents: 'export { createClient } from "@supabase/supabase-js";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "vendor/supabase.js",
  platform: "browser",
  target: "es2022",
});
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "src",
  "vendor",
])
  await cp(file, `dist/${file}`, { recursive: true });
console.log(
  "Static site built in dist/. Root files also work directly on GitHub Pages.",
);
