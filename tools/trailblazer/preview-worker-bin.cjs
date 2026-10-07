// Electron worker for preview_frames_bin.cjs（多图集页版）。
// 基于 spine-anim skill 的 preview-worker.template.cjs，修正：
//   1. 解析 .atlas 里全部页名并逐页加载贴图（原版只加载第一页，
//      把第一页贴图设给所有 page——第二页区域取错 UV）。
//   2. 各页按 atlas 里声明的 size 无关，直接用图片原尺寸。
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const { readFileSync, writeFileSync } = require("node:fs");
const { join, normalize } = require("node:path");

const CFG = {
  skeleton: process.env.PV_SKELETON,
  atlas: process.env.PV_ATLAS,
  anim: process.env.PV_ANIM,
  out: process.env.PV_OUT,
  fps: Number(process.env.PV_FPS || 12),
  frames: Number(process.env.PV_FRAMES || 12),
  width: Number(process.env.PV_W || 800),
  height: Number(process.env.PV_H || 800),
};

const PORT = 8897;
const MIME = { ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".atlas": "text/plain" };

const skeletonText = readFileSync(CFG.skeleton, "utf8");
const atlasText = readFileSync(CFG.atlas, "utf8");
const atlasDir = normalize(join(CFG.atlas, ".."));
// 页名 = 不含冒号且以 .png 结尾的行（页块首行；区域行必带 bounds:/size: 等键）
const pageNames = atlasText.split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.includes(":") && l.toLowerCase().endsWith(".png"));
const pages = pageNames.map((name) => ({
  name,
  data: readFileSync(normalize(join(atlasDir, name))),
}));
const PROJECT_ROOT = process.env.PV_PROJECT_ROOT;

const server = http.createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  const send = (code, body, type) => {
    res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
    res.end(body);
  };
  try {
    if (path === "/spine-webgl.js")
      return send(200, readFileSync(join(PROJECT_ROOT, "node_modules/@esotericsoftware/spine-webgl/dist/iife/spine-webgl.js")), MIME[".js"]);
    if (path === "/skeleton.json") return send(200, skeletonText, MIME[".json"]);
    if (path === "/atlas.atlas") return send(200, atlasText, MIME[".atlas"]);
    if (path.startsWith("/page/")) {
      const name = path.slice("/page/".length);
      const page = pages.find((p) => p.name === name);
      if (!page) return send(404, "no page " + name, "text/plain");
      return send(200, page.data, MIME[".png"]);
    }
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
  const atlas = new SPINE.TextureAtlas(atlasText);
  for (const page of atlas.pages) {
    const resp = await fetch("/page/" + encodeURIComponent(page.name));
    const image = await createImageBitmap(await resp.blob());
    const texture = new SPINE.GLTexture(context, image);
    texture.setFilters(page.minFilter, page.magFilter);
    page.setTexture(texture);
  }
  const skeletonData = new SPINE.SkeletonJson(new SPINE.AtlasAttachmentLoader(atlas)).readSkeletonData(skeletonText);
  const skeleton = new SPINE.Skeleton(skeletonData);
  const skinName = skeletonData.skins.find(s => s.name === "default") ? "default" : skeletonData.skins[0].name;
  skeleton.setSkinByName(skinName);
  skeleton.setSlotsToSetupPose();
  skeleton.updateWorldTransform(SPINE.Physics.update);
  // 相机包围盒按 manifest.cameraExcludeSlots 同名规则排除常驻隐藏道具槽位
  // （与应用端一致；运行时 getBounds 不检查 alpha，桶会把包围盒撑大）
  const EXCLUDE = ${JSON.stringify((process.env.PV_EXCLUDE_SLOTS || 'BIN-BACK,BIN-FRONT,BIN-LID').split(','))};
  const hiddenSlots = [];
  for (const name of EXCLUDE) {
    const slot = skeleton.findSlot(name);
    const att = slot && slot.getAttachment();
    if (att) { hiddenSlots.push([slot, att]); slot.setAttachment(null); }
  }
  const bounds = skeleton.getBoundsRect();
  for (const [slot, att] of hiddenSlots) slot.setAttachment(att);
  // 同应用端：cameraExtend（PV_EXTEND_TOP 传入，世界单位）
  const EXT_TOP = ${Number(process.env.PV_EXTEND_TOP || 0)};
  if (EXT_TOP) { bounds.height += EXT_TOP; }
  const state = new SPINE.AnimationState(new SPINE.AnimationStateData(skeletonData));
  const SETUP = ${process.env.PV_SETUP === '1' ? 'true' : 'false'};
  const HIDE_SLOTS = ${JSON.stringify((process.env.PV_HIDE_SLOTS || '').split(',').filter(Boolean))};
  if (!SETUP) state.setAnimation(0, ${JSON.stringify(CFG.anim)}, true);

  const renderer = new SPINE.SceneRenderer(canvas, context);
  const cam = renderer.camera;
  cam.position.x = bounds.x + bounds.width / 2;
  cam.position.y = bounds.y + bounds.height / 2;
  cam.zoom = Math.max(bounds.width / ${CFG.width}, bounds.height / ${CFG.height}) * 1.15;
  cam.setViewport(${CFG.width}, ${CFG.height});

  const step = 1 / ${CFG.fps};
  const names = [];
  const MEASURE = ${Number(process.env.PV_MEASURE || 0)};
  const MEASURE_FRAME = ${Number(process.env.PV_MEASURE_FRAME || 0)};
  for (let i = 0; i < ${CFG.frames}; i++) {
    if (SETUP) { /* setup 姿态：不推进动画 */ }
    else { state.update(step); state.apply(skeleton); }
    skeleton.updateWorldTransform(SPINE.Physics.update);
    if (HIDE_SLOTS.length) {
      for (const n of HIDE_SLOTS) { const s = skeleton.findSlot(n); if (s) s.color.a = 0; }
      if (!window.__hidLogged) { window.__hidLogged = true;
        console.log("[dbg] hidden:", HIDE_SLOTS.join(","), "-> alpha=", skeleton.findSlot(HIDE_SLOTS[0]).color.a); }
    }
    context.gl.viewport(0, 0, ${CFG.width}, ${CFG.height});
    context.gl.clearColor(0.86, 0.91, 0.95, 1);
    context.gl.clear(context.gl.COLOR_BUFFER_BIT);
    renderer.begin();
    renderer.drawSkeleton(skeleton, false);
    renderer.end();
    if (MEASURE && i === MEASURE_FRAME) {
      // 世界坐标辅助：区域附件 4 参签名（slot, out, offset, stride, 8 值）；
      // 网格附件 6 参签名（slot, start, count, out, offset, stride）
      const worldPts = (s) => {
        const att = s.getAttachment();
        if (!att || !att.computeWorldVertices) return null;
        const isMesh = typeof att.worldVerticesLength === "number";
        const n = isMesh ? att.worldVerticesLength : 8;
        const out = new Float32Array(n);
        if (isMesh) att.computeWorldVertices(s, 0, n, out, 0, 2);
        else att.computeWorldVertices(s, out, 0, 2);
        return out;
      };
      const binNames = ["BIN-BACK", "BIN-FRONT", "BIN-LID"];
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, lowSlot = "";
      for (const s of skeleton.slots) {
        if (binNames.indexOf(s.data.name) >= 0) continue;
        const out = worldPts(s);
        if (!out) continue;
        for (let k = 0; k < out.length; k += 2) {
          if (out[k] < minX) minX = out[k];
          if (out[k] > maxX) maxX = out[k];
          if (out[k + 1] < minY) { minY = out[k + 1]; lowSlot = s.data.name; }
          if (out[k + 1] > maxY) maxY = out[k + 1];
        }
      }
      const bc = worldPts(skeleton.findSlot("BIN-FRONT"));
      let bminX = 1e9, bmaxX = -1e9, bminY = 1e9, bmaxY = -1e9;
      for (let k = 0; k < bc.length; k += 2) {
        bminX = Math.min(bminX, bc[k]); bmaxX = Math.max(bmaxX, bc[k]);
        bminY = Math.min(bminY, bc[k + 1]); bmaxY = Math.max(bmaxY, bc[k + 1]);
      }
      console.log("[measure] PET x[" + minX.toFixed(0) + "," + maxX.toFixed(0) + "] y[" +
        minY.toFixed(0) + "," + maxY.toFixed(0) + "] lowest=" + lowSlot);
      console.log("[measure] BIN x[" + bminX.toFixed(0) + "," + bmaxX.toFixed(0) + "] y[" +
        bminY.toFixed(0) + "," + bmaxY.toFixed(0) + "]");
      const lc = worldPts(skeleton.findSlot("BIN-LID"));
      if (lc) {
        let lminY = 1e9, lmaxY = -1e9, lminX = 1e9, lmaxX = -1e9;
        for (let k = 0; k < lc.length; k += 2) {
          lminX = Math.min(lminX, lc[k]); lmaxX = Math.max(lmaxX, lc[k]);
          lminY = Math.min(lminY, lc[k + 1]); lmaxY = Math.max(lmaxY, lc[k + 1]);
        }
        console.log("[measure] LID x[" + lminX.toFixed(0) + "," + lmaxX.toFixed(0) + "] y[" +
          lminY.toFixed(0) + "," + lmaxY.toFixed(0) + "]");
      }
      if (MEASURE >= 3) {
        for (const b of skeleton.bones) {
          if (["身体", "左小腿", "左小腿2", "右大腿", "右大腿2", "左臂8", "左臂2", "左臂3", "左臂4", "身体2", "身体12", "垃圾桶", "垃圾桶-盖"].indexOf(b.data.name) < 0) continue;
          const ws = Math.sqrt(b.a * b.a + b.c * b.c);
          const ws2 = Math.sqrt(b.b * b.b + b.d * b.d);
          console.log("[bone] " + b.data.name + " world=(" + b.worldX.toFixed(1) + "," + b.worldY.toFixed(1) +
            ") LOCALscale=(" + b.scaleX.toFixed(3) + "," + b.scaleY.toFixed(3) + ") WORLDscale=(" + ws.toFixed(3) + "," + ws2.toFixed(3) +
            ") rot=" + b.rotation.toFixed(1) + " inherit=" + b.inherit);
        }
      }
      if (MEASURE >= 2) {
        for (const s of skeleton.slots) {
          if (binNames.indexOf(s.data.name) >= 0 || s.color.a < 0.5) continue;
          const out = worldPts(s);
          if (!out) continue;
          let sx = 1e9, sy = 1e9, ex = -1e9, ey = -1e9;
          for (let k = 0; k < out.length; k += 2) {
            sx = Math.min(sx, out[k]); ex = Math.max(ex, out[k]);
            sy = Math.min(sy, out[k + 1]); ey = Math.max(ey, out[k + 1]);
          }
          console.log("[slot] " + s.data.name + " " + sx.toFixed(1) + " " + sy.toFixed(1) + " " +
            ex.toFixed(1) + " " + ey.toFixed(1) + " bone=" + s.bone.data.name);
        }
      }
    }
    const url = canvas.toDataURL("image/png");
    names.push(url);
    await new Promise(r => setTimeout(r, 0));
  }
  return names;
};
</script></body></html>`;
}

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
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
      const name = CFG.anim + "_" + String(i).padStart(3, "0") + ".png";
      writeFileSync(join(CFG.out, name), Buffer.from(url.split(",")[1], "base64"));
    });
    console.log("[preview] wrote " + urls.length + " frames to " + CFG.out);
    console.log("[preview] hand these to the user for visual confirmation — do not judge pixels yourself.");
    app.quit();
  } catch (e) {
    console.error("[preview] render failed:", String(e));
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.quit());
