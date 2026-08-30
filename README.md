# Desktop Pet

Windows 桌面陪伴宠物。核心是“陪伴感”，AI 对话与 Obsidian 待办编排作为可插拔技能层。

## 当前实现

- Electron + TypeScript + React + Vite
- Fairy 桌宠 MVP: GIF 显示、点击反应、拖拽、右键菜单、气泡、托盘
- 面板窗口: 对话框、Obsidian 待办列表、设置
- 技能总线: `chat`、`obsidian-todos`
- OpenAI-compatible 自定义 API
- ObsidianBaseService: 解析 `.base` filters, 扫描 Markdown 待办, frontmatter 读写
- Pet Pack 抽象, Live2D 渲染接口预留

## 运行

```powershell
npm install
npm run dev
```

生产构建:

```powershell
npm run build
npm start
```

## Pet Pack

角色放在 `packs/<角色>/manifest.json`:

- `type: "gif"`: 直接播放 GIF
- `type: "live2d"`: 预留接口, 后续接 Live2D Cubism SDK

Fairy 参考素材在 `pet_reference/Fairy/`。
