// Build step: pre-transform JSX -> minified JS with content-hashed filenames, so
// the browser no longer runs @babel/standalone at load time and cache-busting is
// automatic (no manual ?v=). Output goes to dist/; deploy that dir.
//
//   npm install esbuild --no-save    # once
//   node build.mjs
//   wrangler pages deploy dist --project-name sovereign-eye --branch main   ← PRODUCTION
//   wrangler pages deploy dist --project-name sovereign-eye                 ← preview only (master.*)
//
// Per-file transform (bundle:false-style): each .jsx stays its own IIFE attaching
// to window in the same load order — identical runtime model, just precompiled.

import esbuild from "esbuild";
import { createHash } from "node:crypto";
import {
  readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readdirSync, statSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const hash8 = s => createHash("sha256").update(s).digest("hex").slice(0, 8);

// JSX files in dependency/load order (matches index.html).
const JSX = [
  "tweaks-panel.jsx", "components.jsx", "data.jsx", "dd-shared.jsx",
  "debate-room.jsx", "desktop-panels.jsx", "import-modal.jsx", "mobile.jsx", "app.jsx",
];
const PLAIN_JS = ["positions.js", "seed.js", "fire-math.js"];
const CSS = ["styles.css", "mobile.css"];
const STATIC = ["manifest.json", "icon-192.png", "icon-512.png", "sw.js"];
const HTML = ["index.html", "mobile.html"];

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry), d = join(dst, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const built = {}; // original basename -> hashed output name

for (const f of JSX) {
  const out = await esbuild.transform(readFileSync(join(ROOT, f), "utf8"),
    { loader: "jsx", jsx: "transform", minify: true });
  const name = `${f.replace(/\.jsx$/, "")}.${hash8(out.code)}.js`;
  writeFileSync(join(DIST, name), out.code);
  built[f] = name;
}
for (const f of PLAIN_JS) {
  const out = await esbuild.transform(readFileSync(join(ROOT, f), "utf8"),
    { loader: "js", minify: true });
  const name = `${f.replace(/\.js$/, "")}.${hash8(out.code)}.js`;
  writeFileSync(join(DIST, name), out.code);
  built[f] = name;
}
for (const f of CSS) {
  const buf = readFileSync(join(ROOT, f), "utf8");
  const name = `${f.replace(/\.css$/, "")}.${hash8(buf)}.css`;
  writeFileSync(join(DIST, name), buf);
  built[f] = name;
}
for (const f of STATIC) copyFileSync(join(ROOT, f), join(DIST, f));
copyDir(join(ROOT, "functions"), join(DIST, "functions"));

// Rewrite HTML: drop the babel CDN + type="text/babel"; point each local src/href
// at its hashed build artifact.
for (const f of HTML) {
  let html = readFileSync(join(ROOT, f), "utf8");
  html = html.replace(/[ \t]*<script\b[^>]*@babel\/standalone[^>]*><\/script>\s*\n?/g, "");
  html = html.replace(/\s*type="text\/babel"/g, "");
  // Dev React is for source-mode only — production serves the minified builds
  // (the dev UMD bundles are ~3x larger and run extra invariant checks).
  html = html.replace(/react(-dom)?\.development\.js/g, m => m.replace("development", "production.min"));
  html = html.replace(/(src|href)="([^":?]+?)(\?v=[^"]*)?"/g, (m, attr, path) => {
    const base = path.split("/").pop();
    return built[base] ? `${attr}="${built[base]}"` : m;
  });
  writeFileSync(join(DIST, f), html);
}

console.log("Built dist/:", Object.entries(built).map(([k, v]) => `${k}->${v}`).join("  "));
