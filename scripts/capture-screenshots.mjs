import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import http from "http";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const shots = [{ html: "holdings.html", out: "holdings.png", width: 1280, height: 800 }];

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const relative = urlPath === "/" ? "/docs/screenshots/dashboard.html" : urlPath;
      const filePath = path.join(ROOT, relative.replace(/^\//, ""));
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const server = await startServer();
const { port } = server.address();

try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });

  for (const shot of shots) {
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await page.goto(`http://127.0.0.1:${port}/docs/screenshots/${shot.html}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT_DIR, shot.out),
      type: "png",
    });
    console.log(`Saved ${shot.out}`);
  }

  await browser.close();
} finally {
  server.close();
}
