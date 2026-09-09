// 双轨道发光预览：track 0 播 背手（0.2s 后停帧，与 app 行为一致），
// track 1 循环 发光呼吸。基于 spine-anim 技能 preview-worker 模板改造。
// 用法：D:/pet 下运行
//   node_modules/electron/dist/electron.exe tools/promeia/preview_glow.cjs
// 输出 preview-frames/glow/背手_发光呼吸_NNN.png
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join, normalize } = require("node:path");

const PACK = "D:/pet/packs/promeia_back";
const OUT = "D:/pet/preview-frames/glow";
const CFG = {
  pose: "背手",       // track 0：姿势动画，播完停帧
  glow: "发光呼吸",   // track 1：呼吸循环
  fps: 4,
  frames: 16,         // 4s = 一个完整呼吸周期
  width: 800,
  height: 800,
};

const PORT = 8901;
const MIME = { ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".atlas": "text/plain" };

const skeletonText = readFileSync(join(PACK, "promiya_back.json"), "utf8");
const atlasText = readFileSync(join(PACK, "sp.atlas"), "utf8");
const pageName = atlasText.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")).trim();
const pagePng = readFileSync(normalize(join(PACK, pageName)));

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  const send = (code, body, type) => {
    res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
    res.end(body);
  };
  try {
    if (path === "/spine-webgl.js")
      return send(200, readFileSync("D:/pet/node_modules/@esotericsoftware/spine-webgl/dist/iife/spine-webgl.js"), MIME[".js"]);
    if (path === "/skeleton.json") return send(200, skeletonText, MIME[".json"]);
    if (path === "/atlas.atlas") return send(200, atlasText, MIME[".atlas"]);
    if (path === "/page.png") return send(200, pagePng, MIME[".png"]);
    if (path === "/") return send(200, pageHtml(), "text/html; charset=utf-8");
    send(404, "not found", "text/plain");
  } catch (e) {
    send(500, String(e), "text/plain");
  }
});

function pageHtml() {
  return `<!doctype html><html><body style="margin:0"><canvas id="c" width="${CFG.width}" height="${CFG.height}"></canvas>
<script src="http://127.0.0.1:${PORT}/spine-webgl.js"></script>
<script>
window.renderFrames = async () => {
  const SPINE = window.spine;
  const canvas = document.getElementById("c");
  const context = new SPINE.ManagedWebGLRenderingContext(canvas, { alpha: true, antialias: true, preserveDrawingBuffer: true });
  const [skeletonText, atlasText] = await Promise.all([
    fetch("/skeleton.json").then(r => r.text()),
    fetch("/atlas.atlas").then(r => r.text())
  ]);
  const image = await createImageBitmap(await (await fetch("/page.png")).blob());
  const atlas = new SPINE.TextureAtlas(atlasText);
  for (const page of atlas.pages) {
    const texture = new SPINE.GLTexture(context, image);
    texture.setFilters(page.minFilter, page.magFilter);
    page.setTexture(texture);
  }
  const skeletonData = new SPINE.SkeletonJson(new SPINE.AtlasAttachmentLoader(atlas)).readSkeletonData(skeletonText);
  const skeleton = new SPINE.Skeleton(skeletonData);
  skeleton.setSkinByName("default");
  skeleton.setSlotsToSetupPose();
  skeleton.updateWorldTransform(SPINE.Physics.update);
  const bounds = skeleton.getBoundsRect();
  const state = new SPINE.AnimationState(new SPINE.AnimationStateData(skeletonData));
  state.setAnimation(0, ${JSON.stringify(CFG.pose)}, false);
  const glowEntry = state.setAnimation(1, ${JSON.stringify(CFG.glow)}, true);
  glowEntry.mixDuration = 0;

  const renderer = new SPINE.SceneRenderer(canvas, context);
  const cam = renderer.camera;
  cam.position.x = bounds.x + bounds.width / 2;
  cam.position.y = bounds.y + bounds.height / 2;
  cam.zoom = Math.max(bounds.width / ${CFG.width}, bounds.height / ${CFG.height}) * 1.15;
  cam.setViewport(${CFG.width}, ${CFG.height});

  const step = 1 / ${CFG.fps};
  const names = [];
  for (let i = 0; i < ${CFG.frames}; i++) {
    state.update(step);
    state.apply(skeleton);
    skeleton.updateWorldTransform(SPINE.Physics.update);
    context.gl.viewport(0, 0, ${CFG.width}, ${CFG.height});
    context.gl.clearColor(0.86, 0.91, 0.95, 1);
    context.gl.clear(context.gl.COLOR_BUFFER_BIT);
    renderer.begin();
    renderer.drawSkeleton(skeleton, false);
    renderer.end();
    names.push(canvas.toDataURL("image/png"));
    await new Promise(r => setTimeout(r, 0));
  }
  return names;
};
</script></body></html>`;
}

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: CFG.width + 20,
    height: CFG.height + 20,
    show: false,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false },
  });
  win.webContents.on("console-message", (_e, _l, m) => console.log("[page]", m));
  await win.loadURL("http://127.0.0.1:" + PORT + "/");
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const urls = await win.webContents.executeJavaScript("renderFrames()", true);
    urls.forEach((url, i) => {
      writeFileSync(join(OUT, "背手_发光呼吸_" + String(i).padStart(3, "0") + ".png"), Buffer.from(url.split(",")[1], "base64"));
    });
    console.log("[preview] wrote " + urls.length + " frames to " + OUT);
    app.quit();
  } catch (e) {
    console.error("[preview] render failed:", String(e));
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.quit());
