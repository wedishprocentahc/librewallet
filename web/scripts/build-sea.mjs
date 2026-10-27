// Builds a single-file executable for the current OS (Node "single executable application").
// Run it on each target OS (see .github/workflows/web-release.yml). Output: dist/librewallet[.exe]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const work = join(dist, ".sea");
const exe = join(dist, process.platform === "win32" ? "librewallet.exe" : "librewallet");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1) Bundle server + core into one CommonJS file. node:sqlite / node:sea stay as built-in imports.
await build({
  entryPoints: [join(root, "server/main.ts")],
  outfile: join(work, "main.cjs"),
  bundle: true, platform: "node", format: "cjs", target: "node24", sourcemap: false, minify: false,
  define: { __LW_VERSION__: JSON.stringify(version), "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  external: ["node:sqlite", "node:sea"],
});

// 2) Embed the UI as SEA assets.
const assets = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else assets[relative(join(root, "ui"), p).replaceAll("\\", "/")] = p;
  }
})(join(root, "ui"));

const config = join(work, "sea-config.json");
writeFileSync(config, JSON.stringify({ main: join(work, "main.cjs"), output: join(work, "sea.blob"), disableExperimentalSEAWarning: true, assets }));
execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });

// 3) Inject the blob into a copy of the node binary.
mkdirSync(dist, { recursive: true });
copyFileSync(process.execPath, exe);
if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", exe], { stdio: "inherit" });
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
// The official Node binary can contain the fuse sentinel more than once, and postject refuses to flip an ambiguous fuse.
// Hide every copy but the first from postject, inject, then restore and flip the hidden copies ourselves.
const hidden = `X${FUSE.slice(1)}`;
{
  const bin = readFileSync(exe);
  const needle = Buffer.from(`${FUSE}:0`);
  const at = [];
  for (let i = bin.indexOf(needle); i >= 0; i = bin.indexOf(needle, i + needle.length)) at.push(i);
  if (at.length === 0) throw new Error("SEA fuse sentinel not found in the Node binary");
  for (const i of at.slice(1)) bin[i] = 0x58; // 'X'
  writeFileSync(exe, bin);
}
const args = [join(root, "node_modules/postject/dist/cli.js"), exe, "NODE_SEA_BLOB", join(work, "sea.blob"), "--sentinel-fuse", FUSE];
if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
execFileSync(process.execPath, args, { stdio: "inherit" });
{
  const bin = readFileSync(exe);
  const needle = Buffer.from(`${hidden}:0`);
  for (let i = bin.indexOf(needle); i >= 0; i = bin.indexOf(needle, i + needle.length)) {
    bin[i] = 0x4e; // 'N'
    bin[i + needle.length - 1] = 0x31; // ':1'
  }
  writeFileSync(exe, bin);
}
if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", exe], { stdio: "inherit" });
rmSync(work, { recursive: true, force: true });
console.log(`Built ${exe}`);
