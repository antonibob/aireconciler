// Minimal bundler: compiles the taskpane (React + engine + model) into dist/
// for Office sideload over https://localhost:3000. Start: `npx serve dist`.
import { build } from "esbuild";

// Taskpane entry — the live UI.
await build({
  entryPoints: ["src/taskpane/index.tsx"],
  bundle: true,
  outfile: "dist/taskpane.js",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
});

// Commands entry — required by the manifest's FunctionFile (ribbon command names).
await build({
  entryPoints: ["src/taskpane/index.tsx"],
  bundle: true,
  outfile: "dist/commands.js",
  format: "esm",
});

console.log("Built dist/. Run `npx serve dist` and sideload manifest.xml (localhost:3000).");