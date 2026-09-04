// Minimal bundler: compiles the taskpane (React + engine + model) into dist/
// and copies the Office shell + icons. Then: npx serve dist  (or the dev-certs
// https server in scripts/serve.mjs) and sideload manifest.xml.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// 1. Taskpane entry — the live UI.
await build({
  entryPoints: ["src/taskpane/index.tsx"],
  bundle: true,
  outfile: "dist/taskpane.js",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
});

// 2. Commands entry — required by the manifest's FunctionFile.
await build({
  entryPoints: ["src/taskpane/index.tsx"],
  bundle: true,
  outfile: "dist/commands.js",
  format: "esm",
});

// 3. Copy the Office HTML shell (loads Office.js from CDN) + CSS + icons.
mkdirSync("dist/assets", { recursive: true });
copyFileSync("src/taskpane/taskpane.html", "dist/taskpane.html");
copyFileSync("src/taskpane/taskpane.html", "dist/commands.html");
for (const s of [16, 32, 80]) {
  copyFileSync(`src/assets/icon-${s}.png`, `dist/assets/icon-${s}.png`);
}

console.log("Built dist/. Watch it at http://localhost:3000/taskpane.html");