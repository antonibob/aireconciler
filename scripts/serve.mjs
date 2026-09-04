// Local dev server for sideloading the add-in. Excel requires HTTPS with a
// trusted cert. If you've run `npx office-addin-dev-certs install`, we reuse
// its certs; otherwise fall back to a plain-HTTP listener (add-in sideload
// needs https, but the demo works over http in a browser).
import { createServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createServer as createHttp } from "node:http";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// office-addin-dev-certs stores its trusted localhost cert here.
const certDir = join(homedir(), ".office-addin-dev-certs");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};

function handler(req, res) {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/taskpane.html";
  const file = normalize(join(DIST, p));
  if (!file.startsWith(normalize(DIST))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

const https = existsSync(certDir + "/localhost.crt") && existsSync(certDir + "/localhost.key");
const server = https
  ? createServer(
      { cert: readFileSync(certDir + "/localhost.crt"), key: readFileSync(certDir + "/localhost.key") },
      handler,
    )
  : createHttp(handler);

server.listen(PORT, () => {
  console.log(`AI Closer serving ${DIST} on ${https ? "https" : "http"}://localhost:${PORT}/`);
  if (!https)
    console.warn(
      "No localhost cert found (https://localhost:3000 required for Excel sideload).\n" +
        "Run: npx office-addin-dev-certs install",
    );
});