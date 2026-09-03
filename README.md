# Desktop Pet

Windows 桌面陪伴宠物。核心是“陪伴感”，AI 对话与 Obsidian 待办编排作为可插拔技能层。

## 当前实现

- Electron + TypeScript + React + Vite
- Fairy GIF 桌宠与 Mualani Spine 4.2 骨骼动画桌宠，支持双角色切换
- 每个角色独立的人设（`persona.json`）与语料响应规则表（`corpus.json`），可直接编辑 JSON
- 角色切换置顶：切换角色会联动设置页、对话上下文与宠物视觉
- 面板窗口：对话框、Obsidian 待办列表、设置
- 技能总线：`chat`、`obsidian-todos`
- OpenAI-compatible 自定义 API
- ObsidianBaseService：解析 `.base` filters、扫描 Markdown 待办、frontmatter 读写
- 设计/开发文档位于 `docs/`（`DESIGN.md`、`ROADMAP.md`）

## 运行

```powershell
npm install
npm run dev
```

生产构建：

```powershell
npm run typecheck
npm run build
npm start
```

## Pet Pack

角色放在 `packs/<角色>/`：

- `manifest.json`：角色包清单（id/name/type/assetPaths 等）
- `persona.json`：人设配置（name/description/personality/systemPrompt/traits）
- `corpus.json`：语料响应规则表（enabled/空闲计时/phrases）
- `type: "gif"`：直接播放 GIF（Fairy）
- `type: "spine"`：加载 Spine JSON + atlas + 图集（Mualani，spine-canvas 渲染）
- `type: "live2d"`：预留接口，后续接 Live2D Cubism SDK

人设与语料也可以在设置面板中直接以 JSON 编辑并保存，或点击“打开配置目录”在文件系统中修改。

## Mualani 素材

- 源素材：`pet_reference/Mualani/`（Spine 4.2.35 导出，含 `mlnxr.json`、`sl.atlas`、`mlnxr.png` 与 `images/` 拆件）
- 运行副本：`packs/mualani/`（仅 JSON + atlas + 图集）
- 动画：`loop`、`loop笑`、`walk`、`抬手示意`、`冲浪`、`拍手x` 等 17 个动画

## Mualani 动画与表情设置

Mualani 的互动重点在动画切换与表情槽位：

### 待机互动

- 默认待机动画是 `eye`。
- 应用会按设置面板中的 **眨眼间隔** 周期性重放 `eye`，形成待机眨眼效果。
- 眨眼间隔可在设置面板调整，取值范围为 `1` 到 `10` 秒。

### 点击互动

- 点击 Mualani 时不会固定播放同一个动作，而是从角色包动画池中随机选择。
- 当前动画池排除 `eye`、`loop`、`loop笑`、`walk`、`举手张嘴`、`闹钟提示`，避免待机/移动/特殊提示动画干扰点击反馈。
- 点击动画会尽量避开上一次播放的动作，减少连续重复感。
- 当前包中的候选动作包括 `抬手示意`、`冲浪`、`拍手x`、`点点头`、`打瞌睡`。

### 拖动互动

- 拖动中使用 `eye` 作为基础动作。
- 拖动时会强制切换到专用拖动表情 `gt-lt-eyes`，并隐藏常规眼部槽位，突出“被拎起来”的表情。
- 松开后播放短暂下落/回弹形变，然后进入 `冲浪` 动画作为落地衔接。
- `冲浪` 被拆分为出场、返回和下板三段，确保动作节奏适合桌宠窗口。

### 如何调整

- 增减 `packs/mualani/manifest.json` 中的 `animations` 数组，即可调整点击互动可随机到的动作。
- 拖动表情、待机动画、落地动画与排除列表当前由应用代码管理；后续如需按角色包完全自定义，可继续把这些映射迁移到 `manifest.json`。
