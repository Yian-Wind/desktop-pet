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
