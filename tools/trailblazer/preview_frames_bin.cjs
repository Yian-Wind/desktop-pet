#!/usr/bin/env node
// 多图集页版预览渲染器（配合 preview-worker-bin.cjs）。
// 用法与 spine-anim skill 的 preview_frames.js 一致：
//   node tools/trailblazer/preview_frames_bin.cjs <skeleton.json> <atlas>
//        [--anim name] [--out-dir dir] [--fps 12] [--frames 12] [--width 640] [--height 640]
const { spawnSync } = require("node:child_process");
const { mkdirSync, existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const argv = process.argv.slice(2);
const skeletonPath = argv[0];
const atlasPath = argv[1];
if (!skeletonPath || !atlasPath) {
  console.error("usage: preview_frames_bin.cjs <skeleton.json> <atlas> [--anim name] [--out-dir dir] [--fps n] [--frames n] [--width n] [--height n]");
  process.exit(1);
}
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

let projectRoot = process.cwd();
for (let p = projectRoot; ; p = resolve(p, "..")) {
  if (existsSync(join(p, "node_modules/@esotericsoftware/spine-webgl"))) { projectRoot = p; break; }
  if (p === resolve(p, "..")) {
    console.error("error: no node_modules/@esotericsoftware/spine-webgl found in cwd or ancestors");
    process.exit(1);
  }
}
const electronBin = join(projectRoot, "node_modules", ".bin", "electron");
const electronExe = process.platform === "win32"
  ? [join(projectRoot, "node_modules", "electron", "dist", "electron.exe"), electronBin + ".cmd", electronBin]
      .find((p) => existsSync(p))
  : electronBin;
if (!electronExe) { console.error("error: electron binary not found in " + projectRoot); process.exit(1); }

const workerPath = join(__dirname, "preview-worker-bin.cjs");
const fps = Number(flag("--fps", 12));
const frames = Number(flag("--frames", 12));
const outDir = resolve(flag("--out-dir", join(process.cwd(), "preview-frames")));
mkdirSync(outDir, { recursive: true });

const res = spawnSync(electronExe, [workerPath], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PV_SKELETON: resolve(skeletonPath),
    PV_ATLAS: resolve(atlasPath),
    PV_ANIM: flag("--anim") || "idle",
    PV_OUT: outDir,
    PV_FPS: String(fps),
    PV_FRAMES: String(frames),
    PV_W: String(Number(flag("--width", 800))),
    PV_H: String(Number(flag("--height", 800))),
    PV_PROJECT_ROOT: projectRoot,
  },
  stdio: "inherit",
});
process.exit(res.status ?? 1);
