// Minimal bundler: compiles the taskpane (React + engine + model) into dist/
// and copies the Office shell + icons. Then: npx serve dist  (or the dev-certs
// https server in scripts/serve.mjs) and sideload manifest.xml.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, statSync } from "node:fs";

const production = process.env.NODE_ENV !== "development";

// 1. Taskpane entry — the live UI.
await build({
  entryPoints: ["src/taskpane/index.tsx"],
  bundle: true,
  outfile: "dist/taskpane.js",
  define: { "process.env.NODE_ENV": production ? '"production"' : '"development"' },
  minify: production,
  sourcemap: !production,
  legalComments: "none",
  target: ["es2021"],
});

// 2. Commands entry — the manifest's FunctionFile. A stub: the ribbon button
// opens the taskpane directly, so this registers no ExecuteFunction handlers.
await build({
  entryPoints: ["src/commands/commands.ts"],
  bundle: true,
  outfile: "dist/commands.js",
  minify: production,
  legalComments: "none",
  target: ["es2021"],
});

// 3. Copy the Office HTML shells + icons. Each page loads its OWN bundle;
// commands.html previously loaded the taskpane bundle and mounted the entire
// UI in a hidden frame.
mkdirSync("dist/assets", { recursive: true });
copyFileSync("src/taskpane/taskpane.html", "dist/taskpane.html");
copyFileSync("src/commands/commands.html", "dist/commands.html");
// Manifest is served from dist so the Trusted Catalog can point at
// https://localhost:3000/manifest.xml.
copyFileSync("manifest.xml", "dist/manifest.xml");

const kb = (f) => `${(statSync(f).size / 1024).toFixed(0)} KB`;
console.log(`Built dist/ — taskpane.js ${kb("dist/taskpane.js")}, commands.js ${kb("dist/commands.js")}`);
console.log("Serve it with: npm run serve");
