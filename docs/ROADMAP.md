# Desktop Pet 里程碑规划

> 状态: 进行中  
> 日期: 2026-08-30  
> 用途: 面向新会话/接手的执行地图，与 `docs/DESIGN.md`（设计方案）配合使用。

## 0. 现状基线（M0 已完成）

- 工程: Electron + TypeScript + React + Vite，`npm run dev` / `npm run build` 可用。
- Fairy: GIF 透明桌宠窗口（透明置顶、点击、拖拽、右键原生菜单、气泡、托盘）。
- Mualani: Spine 4.2 骨骼动画（`mualani.json` + `sl.atlas` + `mlnxr.png`）已接入 `packs/mualani`，通过 spine-canvas 渲染并支持动作映射。
- 面板: 对话历史、Obsidian 待办列表、设置（自动保存 + 状态提示）。
- 能力层: 技能总线（`chat`、`obsidian-todos`）、LLMClient（OpenAI-compatible）、ObsidianBaseService（多 `.base` 解析 + Markdown 读写）。
- API: 已联通。Base URL `https://api.b.ai/v1` + 本地代理 `http://127.0.0.1:7897`，Model `deepseek-v4-flash`，实测 HTTP 200。
- 配置: `baseFiles[]`、`proxy` 已接入；人设与语料改为每角色 `persona.json` / `corpus.json`，支持设置面板直接编辑 JSON。
- 素材: `pet_reference/Mualani/` 已确认为 Spine 4.2 导出素材，`images/` 为拆分源文件，运行只需 JSON + atlas + 图集。

### 已知边界
- `petPosition.x/y` 仍存的是浮点，若开启 DPI 缩放可能有偏差。
- Obsidian 提醒仅为配置 + 行为引擎空闲触发，尚无基于 due date 的定时提醒调度。
- 写回（新增/完成）只有 API，UI 层尚无明确“确认后写回”弹窗。
- 行为引擎以规则为主，`behaviorMode: llm` 预留未实现。
- Spine 动作映射目前为代码常量（idle/click/drag/sleep/wake），尚未支持 per-pack 自定义映射。

---

## 1. M0 基础（已完成）

- 工程骨架、Fairy MVP、技能总线、Obsidian `.base` 解析、多 Base、API 扮演、自动保存、代理、原生右键菜单。
- 人设与语料响应规则表改为每角色 JSON 配置（`persona.json` / `corpus.json`），角色切换置顶并联动整个设置页、对话上下文与宠物视觉。
- Mualani Spine pack 接入：加载、渲染、双角色切换释放/加载资源。

**验收**: `npm run typecheck` / `npm run build` 通过；应用可启动；Fairy 与 Mualani 可切换；人设/语料 JSON 可编辑并持久化。

---

## 2. M1 行为与对话（进行中）

目标: 让宠物“活起来”，对话体验完整。

- [ ] 流式输出（SSE / stream）到面板与气泡
- [ ] LLM 行为决策 `behaviorMode: llm`（动作/表情/气泡由模型给，带规则回退）
- [ ] 对话错误/超时/重试兜底，断网时可离线互动的规则态
- [ ] 对话历史持久化（当前仅在主进程内存，按角色隔离）
- [ ] 快捷键与输入体验打磨（连续对话、清空、长文本）

---

## 3. M2 素材与 Spine（进行中）

目标: 完善 Mualani 骨骼动画在桌宠场景的展示。

- [x] 确认 `pet_reference/Mualani/` 为 Spine 4.2.35 导出素材（JSON + atlas + 图集）
- [x] 定义 `type: "spine"` Pet Pack，托管 `mualani.json` / `sl.atlas` / `mlnxr.png`
- [x] `SpinePetVisual` 实装（加载、渲染、自适应缩放、动作映射）
- [x] Fairy 与 Mualani 双 Pack 切换时正确释放/加载资源
- [ ] 动作映射可配置化（per-pack `animations.json` 或 manifest 字段）
- [ ] Spine 素材授权与打包规则确认（个人使用）

---

## 4. M3 Obsidian 深层集成

目标: 从“能读”到“能按真实数据提醒并受控写回”。

- [ ] 解析 `.base` 视图的 `order`/`filters`/`formulas`，复刻其排序与剩余天数
- [ ] 基于 `截止日期` + 紧急程度做定时提醒调度（工作时段、频率、去重）
- [ ] 写回确认弹窗（新增/完成/修改前让用户确认，可撤销）
- [ ] 待办详情页展示正文、链接、子任务
- [ ] `baseName` 维度分组/筛选界面

---

## 5. M4 技能扩展与系统集成

目标: 增强能力边界，保持核心稳定。

- [ ] 技能插件标准化（独立注册、配置、启停）
- [ ] 系统动作技能（打开应用、提醒、截图）——需权限确认
- [ ] 多模型/多 Provider 配置存档
- [ ] 键盘快捷键与全局热键

---

## 6. M5 打包与发布

- [ ] electron-builder 配置（安装包 + 便携版）
- [ ] 图标、版本号、安装路径
- [ ] 开机自启实际行为验证
- [ ] 代码签名 / 白名单说明
- [ ] 资源路径打包适配（`packs/`、`pet_reference/` 是否进包）

---

## 7. M6 质量与打磨

- [ ] 单元测试（config merge、base 解析、endpoint 解析、persona 组装）
- [ ] 视觉验收（宠物窗口、面板、多分辨率）
- [ ] 性能（动画帧率、GIF/Spine 内存）
- [ ] 异常上报与日志

---

## 8. 优先级建议（下一个会话）

1. **M1**: 对话流式 + LLM 行为决策 + 错误兜底（当前 API 已通，收益最大）
2. **M3**: Obsidian 定时提醒 + 写回确认（真实待办价值）
3. **M2**: Spine 动作映射可配置化 + 授权/打包规则确认

---

## 9. 搬运注意（新会话）

- API Key 在 `%APPDATA%\desktop-pet\pet-config.json`（明文）与 `.key.enc`（safeStorage 加密）。
- 代理端口 `7897` 是 Sakura Cat 本地监听，会话环境需保持代理开启。
- `pet_reference/Mualani/` 是 Spine 源素材（含 `images/` 拆件），运行副本在 `packs/mualani/`（仅 JSON + atlas + 图集）。
- 人设/语料 JSON 由设置面板保存到 `packs/<id>/persona.json` 与 `packs/<id>/corpus.json`。
