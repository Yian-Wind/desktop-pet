# 桌面宠物 (Desktop Pet) 设计文档

> 版本: v0.2  
> 日期: 2026-08-30  
> 状态: 设计草案，待最终审核后进入 Writing Plans

---

## 1. 产品定位与范围

### 1.1 产品定位
一款 Windows 桌面陪伴宠物。核心是“陪伴感”，AI 对话和 Obsidian 待办编排作为可插拔技能层。

### 1.2 首版范围
- **平台**: Windows 10/11 桌面端
- **运行方式**: 托盘常驻 + 可选开机自启，透明置顶桌宠窗口
- **角色数量**: 单宠运行，通过设置面板切换 Pet Pack
- **角色支持**:
  - Fairy: 直接使用参考 GIF，不生产额外动画素材
  - 第二角色 (Mualani/玛拉妮): 使用 WebM 透明动画，首版最小动作集 + 对话气泡，后续扩展完整动作集
- **技能集**: AI 对话 + Obsidian 待办查询/提醒，无天气/系统自动化等附加功能
- **Obsidian 集成**: 通过 `.base` 文件入口，读取待办文件夹下的 Markdown 文件，只读+受控写回

### 1.3 非目标
- 跨平台 (Windows/macOS/Linux)
- 多宠同屏
- 天气/日历/系统监控等额外技能
- 深度自动化 (AI 自主写回文件)

### 1.4 验收标准
- 在 Windows 10/11 可安装/运行，窗口透明且置顶
- Fairy 以 GIF 显示，第二角色能播放 WebM 动作和对话气泡
- 配置自定义 OpenAI-compatible API 后可对话，断网/无 Key 时宠物保持基本待机和交互
- 配置 Obsidian 库路径后，能读取待办 `.base` 和对应 `.md` 文件，展示待办并触发受控提醒
- 新增/完成/修改待办需经用户确认

---

## 2. 技术栈

| 层级 | 技术选型 |
|------|----------|
| 桌面框架 | Electron 28+ |
| 前端 | TypeScript + React 18+ |
| 动画 | WebM VP9-alpha (Chrome/Chromium) + GIF |
| 状态管理 | React Context + 轻量 Store |
| 构建 | Vite + electron-builder |
| 安全存储 | electron-store 或系统 keychain |
| 网络 | fetch / axios (OpenAI-compatible API) |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────┐
│                   Electron 主进程 (Node/TS)           │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ConfigStore│  │SkillBus   │  │ObsidianBaseService│  │
│  │(安全存储)  │  │(技能注册)  │  │(.base + .md 读写)│  │
│  └──────────┘  └───────────┘  └──────────────────┘  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │LLMClient │  │PetPackMgr │  │Tray/Window/Startup│  │
│  │(OpenAI兼容)│  │(角色包加载) │  │(窗口/托盘/自启)   │  │
│  └──────────┘  └───────────┘  └──────────────────┘  │
└─────────────────────┬───────────────────────────────┘
                      │ IPC
┌─────────────────────┴───────────────────────────────┐
│                React 渲染进程                          │
│  ┌──────────────┐  ┌───────────────┐                 │
│  │宠物窗口(透明置顶) │  │面板窗口(设置/待办)│              │
│  │ WebM/GIF 播放  │  │ 对话历史/待办列表│              │
│  │ 点击/拖拽/右键  │  │ 设置/告警确认  │              │
│  │ 气泡/通知      │  │               │              │
│  └──────────────┘  └───────────────┘                 │
└─────────────────────────────────────────────────────┘
```

### 3.1 主进程模块

**ConfigStore**: 本地安全存储
- API 配置 (Base URL, API Key, Model)
- Obsidian Vault 路径、选中的 `.base` 文件路径
- 当前 Pet Pack、窗口位置、缩放
- 提醒规则 (工作时段、频率、打断保护)

**LLMClient**: OpenAI-compatible 接口适配层
- 只面向 OpenAI Chat Completions 格式
- 不预置任何厂商，由用户自由配置
- 超时/重试/错误处理，失败时通知 BehaviorEngine 走回退

**SkillBus**: 技能注册与调度总线
- 注册: `registerSkill(name, handler)`
- 首版技能: `chat` (对话)、`obsidian-todos` (待办)
- 技能统一接口: `(params: any) => Promise<SkillResult>`
- LLM 可通过 `skillCall` 字段触发技能

**ObsidianBaseService**: Obsidian Base 集成
- 解析 `.base` 文件 YAML，读取 `filters`、`order`、`properties`
- 按 `file.folder` 过滤器扫描对应目录下的 `.md` 文件
- 解析 frontmatter (`完成`, `紧急程度`, `截止日期`)
- 读取文件正文作为事项详情
- 写操作 (新增/完成/修改) 仅修改 `.md` 文件，不修改 `.base` 定义

**PetPackManager**: 角色包加载
- 加载 Pet Pack 清单 (manifest.json)
- 管理角色素材目录 (GIF / WebM 动画 + 配置文件)
- 切换角色时通知窗口重新加载

**Tray/Window/Startup**: 系统集成
- 系统托盘: 右键菜单 (切换角色、设置面板、退出)
- 开机自启: 可选 (默认关闭)
- 窗口管理: 透明置顶窗口、面板窗口

### 3.2 渲染进程模块

**宠物窗口**: 透明置顶无边框窗口
- 播放 WebM 透明动画 (Chrome 原生 `<video>` 支持)
- 播放 GIF 动画 (Fairy 模式)
- 气泡显示 (对话/提醒/情感)
- 鼠标事件: 点击反应、拖拽甩抛、右键菜单
- 自动漫游/居停

**面板窗口**: 可展开的 UI 面板
- 对话历史 (与 LLM 的交互记录)
- 待办列表 (当前筛选的待办，支持排序/筛选)
- 配置编辑 (API、Vault/Base 路径、角色切换、提醒设置)

---

## 4. Pet Pack 规范

### 4.1 目录结构

```
packs/
├── fairy/                          # Fairy 角色包
│   ├── manifest.json               # 角色包清单
│   ├── sprite.gif                  # 参考/动画 GIF
│   ├── click.png                   # 点击反馈 (可选)
│   └── config.jsonc                # 角色配置 (权重/缩放)
│
└── mualani/                        # 第二角色 (Mualani)
    ├── manifest.json               # 角色包清单
    ├── animations/                 # WebM 动画目录
    │   ├── idle.webm               # 待机
    │   ├── click.webm              # 点击反应
    │   ├── drag.webm               # 拖拽
    │   ├── sleep.webm              # 睡觉
    │   └── bubble.webm             # 对话气泡 (可选)
    ├── assets/                     # 辅助素材
    │   └── cursor.png              # 光标
    └── config.jsonc                # 角色配置
```

### 4.2 manifest.json 字段

```json
{
  "id": "mualani",
  "name": "Mualani",
  "version": "1.0.0",
  "type": "webm",
  "animations": [
    "idle", "click", "drag", "sleep", "bubble"
  ],
  "defaultScale": 1.0,
  "author": ""
}
```

### 4.3 素材来源
- Fairy: 用户提供的参考 GIF
- Mualani: 需通过素材管线自生成 (见第 8 节)

---

## 5. 行为引擎 (BehaviorEngine)

### 5.1 事件模型
- 用户事件: 点击、双击、拖拽、右键菜单、对话输入
- 系统事件: 空闲计时、待办提醒触发、技能完成/失败
- 外部事件: LLM 主动推送 (如提醒)

### 5.2 决策流程
1. 事件触发 → BehaviorEngine 接收
2. 检查 LLM 是否可用 (有 Key + 网络正常)
3. **LLM 决策**: 若可用，请求 LLM 返回结构化 JSON
   ```json
   { "action": "idle", "emotion": "happy",
     "bubble": "今天事情不多呢~",
     "skillCall": null }
   ```
4. **回退规则**: 若 LLM 不可用/超时/失败，走本地规则
   - 空闲 > 30s → 随机权重选动作
   - 点击 → 弹跳动画 + 随机气泡
   - 拖拽 → 惯性甩抛 + 反弹
   - 提醒 → 指定动作 + 气泡

### 5.3 动作播放
- 动作名称必须匹配当前 Pet Pack 的 `animations` 列表
- 动作间无缝衔接 (前一个动画播完立即选下一个)
- 权重系统: 待机 > 漫游 > 转向 > 特殊

---

## 6. 技能总线 (SkillBus)

### 6.1 技能接口
```typescript
interface Skill {
  name: string;
  description: string;
  execute(params: Record<string, any>): Promise<SkillResult>;
}

interface SkillResult {
  success: boolean;
  data?: any;
  error?: string;
  bubble?: string;
  action?: string;
}
```

### 6.2 首版技能: chat

**配置**: 无 (复用 LLMClient)
**功能**: 多轮对话, 流式输出到面板, 气泡显示简略回复
**LLM 触发**: 直接在 `skillCall` 中传 `{"skill": "chat", "messages": [...]}`

### 6.3 首版技能: obsidian-todos

**配置**: 用户选择 `.base` 文件路径
**功能**:
- 查询: 按 `.base` 的 filters 列出待办, 支持排序/筛选
- 详情: 展开显示单条待办正文
- 新增: LLM 生成 → 用户确认 → 写入 `.md` 文件
- 完成: LLM 标记 → 用户确认 → 修改 frontmatter
- 提醒: LLM 触发 + 规则保底 (频率/时段/打断保护)

---

## 7. Obsidian 集成细则

### 7.1 数据结构确认
- 待办目录: `Vault_大三上/待办条目/` 及其子目录
- 待办文件: `.md` 文件, 文件名 = 待办标题
- frontmatter 属性:
  - `完成`: `true` / `false`
  - `紧急程度`: `🔴重要紧急` / `🟡重要不紧急` / `🟢不重要紧急` / `🔵不重要不紧急` (或空)
  - `截止日期`: `YYYY-MM-DD` (或空)
- 待办正文: 事项详情、链接、子任务列表

### 7.2 .base 文件的用途
- `.base` YAML 文件定义视图和筛选规则
- 应用读取 `.base` 的 `filters` 确定待办扫描范围
- 应用读取 `.order` 确定默认排序
- 首版不修改 `.base` 文件

### 7.3 读写策略
- 读取: 直接文件系统操作 (Node fs)
- 写入: 仅修改 `.md` 文件
  - 新增: 创建 `.md` 文件, 写入 frontmatter + 正文
  - 完成: 修改 `完成: true`
  - 紧急程度/截止日期修改: 修改对应 frontmatter
- 写入前必须通过 UI 确认 (LLM 不能直接写)

---

## 8. 素材管线 (Mualani/玛拉妮)

### 8.1 调研结论

玛拉妮的素材制作有多条可行路线，按成熟度和质量排序:

#### 路线 A (推荐): 3D 模型提取 + Blender 渲染

**工具链**:
1. **GenshinStudio** (github.com/Mu-L/GenshinStudio) — 提取原神游戏内资源，玛拉妮是 5.0 版本实装角色，模型、贴图、骨骼均在资源包中
2. **Blender** + **gacha-setup** (github.com/PaoloESAN/gacha-setup) — 自动绑骨、toon shader、面捕，一步导入 Genshin/HSR/ZZZ 模型
3. **blender_mmd_genshin_shader_importer** (github.com/BobH233/blender_mmd_genshin_shader_importer) — 导入原神风格材质到 MMD 模型
4. 在 Blender/MMD 中渲染各动作的绿幕视频 (待机、点击、拖拽、睡觉、对话等)
5. **dsh-pet 素材链** (chroma_step02.py + normalize_step03.py + encode_thumbs.py) — 绿幕抠像 → 归一化 2160×1215 → 640×360 WebM VP9-alpha

**优点**: 质量最高、动作可控、帧间一致、全流程可复现
**缺点**: 需要安装 GenshinStudio (约 20-30GB 空间) + Blender 渲染工作
**版权**: 个人使用无风险，不公开发布模型文件

#### 路线 B: AI 视频生成 + 抠像

**工具链**:
1. 玛拉妮 LoRA 资源丰富: Civitai 上有 15+ 个 LoRA (SD1.5/PonyXL/SDXL/Illustrious)，下载量最高 2807 次，角色一致性高
2. 图片生成: 使用 LoRA + SD/Pony 生成各动作的参考帧
3. 视频生成: Wan 2.2 / Kling / Hailuo / Vidu (API) 将参考图转为短视频
4. dsh-pet 素材链抠像转 WebM

**优点**: 无需 3D 模型、上手快、可快速验证
**缺点**: 帧间一致性不如 3D 渲染、精确动作控制有限、API 按次收费、需要 GPU

#### 路线 C: 现有 MMD 模型购买

**来源**: 44mmd.com 有 HoYoFair 官方玛拉妮 MMD 模型，VIP 200 元
**优点**: 即买即用，不需要提取
**缺点**: 需要付费、模型质量受限于转换者、后续动作扩展受限

#### 路线 D: 其他

- Sketchfab: 2 个 CC Attribution 模型，但不可下载
- Kaitou-e Blender 模型库: 不含玛拉妮
- Live2D / VRM: 未发现公开的玛拉妮资源

### 8.2 推荐方案

**首版走路线 A (3D 模型提取 + Blender 渲染)**，理由:
- 玛拉妮是正式角色，游戏内模型完整、骨骼完整
- GenshinStudio + gacha-setup 工具链成熟，社区活跃
- 可以精确制作待机、点击、拖拽、睡觉、对话气泡 5 个动作
- 渲染绿幕视频 → dsh-pet 抠像 → WebM → Pet Pack，流水线已打通

**备选**: 路线 B (AI 视频生成) 可用于快速验证动作效果，或在不方便安装 GenshinStudio 时先行测试

### 8.3 动作集 & 制作计划

| 动作 | 优先级 | 制作方式 | 备注 |
|------|--------|----------|------|
| idle (待机) | P0 | 3D 渲染 | 呼吸循环，2-3 秒 |
| click (点击反应) | P0 | 3D 渲染 | 弹跳/挥手，1 秒 |
| drag (拖拽) | P0 | 3D 渲染 | 悬空/惯性，由代码驱动位置 |
| sleep (睡觉) | P1 | 3D 渲染 | 眯眼/蜷缩，后续做 |
| bubble (对话气泡) | P0 | 代码层 | 非动画，UI 气泡层 |
| turn (转向) | P1 | 3D 渲染 | 后续扩展 |
| roam (漫游) | P1 | 3D 渲染 | 后续扩展 |

### 8.4 素材链依赖

- Python 3.10+ (标准库 + numpy + scipy)
- ffmpeg 9.0+ (含 libvpx-vp9 支持)
- 脚本直接复用 dsh-pet 的 chroma_step02.py、normalize_step03.py、encode_thumbs.py
- 无需额外第三方库

---

## 9. 配置与状态

### 9.1 用户配置项
- API 配置: Base URL, API Key, Model (自由文本)
- Obsidian: Vault 路径, 选中的 `.base` 文件路径
- 角色: 当前 Pet Pack ID, 窗口位置 (x, y, scale)
- 提醒: 工作时段, 频率上限, 是否启用主动提醒
- 开关: 开机自启, 托盘常驻

### 9.2 状态持久化
- 本地配置文件 (JSON, 存储在 `%APPDATA%/pet/` 或 electron-store)
- API Key 单独安全存储

---

## 10. 里程碑

| 阶段 | 内容 | 交付物 |
|------|------|--------|
| M1 核心框架 | Electron 窗口, 透明置顶, 托盘, 设置面板, Fairy GIF 显示, 点击/拖拽 | 可运行桌宠应用 |
| M2 动画与交互 | Pet Pack 加载, WebM 播放, 第二角色动作集, 气泡/右键菜单 | 双角色可切换 |
| M3 AI 对话 | LLMClient, 预设 OpenAI-compatible 配置, 气泡对话, 面板对话历史 | 可对话桌宠 |
| M4 行为引擎 | BehaviorEngine, LLM 决策 + 规则回退, 情绪/动作联动 | 非 LLM 时也有基本行为 |
| M5 Obsidian 待办 | ObsidianBaseService, 面板待办列表, 受控写回, 主动提醒 | 完整待办能力 |
| M6 素材 & 打磨 | Mualani 素材管线, 多动作生成, 动画过渡, 打包安装 | 可发布版本 |

---

## 11. 待定项

- Mualani 素材路线: 等待用户确认走 3D 提取还是 AI 视频生成路线
- 面板 UI 设计: 具体 layout 和交互细节 (后续设计阶段定)
- 动画素材具体数量: 按最小动作集先做, 后续扩展
- 打包/分发方式: 安装包计划 (后续定)

## 11.1 当前实现状态 (v0.1)

已完成基础工程与 Fairy 桌宠 MVP:

- Electron + TypeScript + React + Vite 工程已搭好 (`npm run dev` / `npm run build`)
- Fairy 以 GIF 显示，`pet-asset://` 协议加载角色素材
- 宠物窗口: 透明置顶、点击反应、拖拽甩抛、右键菜单、气泡
- 面板窗口: 对话历史、Obsidian 待办、设置 (API/Vault/角色/提醒/自启)
- 技能总线: `chat` 与 `obsidian-todos` 两个技能已注册
- LLMClient: OpenAI-compatible 自定义接口
- ObsidianBaseService: 解析 `.base` filters, 扫描 Markdown 待办, frontmatter 读写
- Pet Pack 抽象 + Live2D 渲染接口预留 (`PetVisualAdapter` / `Live2DPetAdapter`)

已验证: `npm run build` 通过，Electron 启动成功，Fairy GIF 渲染正常 (640×480 源图缩放至 320×320 窗口)。

---

## 12. 设计决策记录

| # | 决策 | 选择 |
|---|------|------|
| 1 | 产品内核 | 陪伴型桌宠, 技能作为附加能力 |
| 2 | 首版平台 | Windows 10/11 |
| 3 | 形象形态 | Fairy: GIF; Mualani: Q版 Live2D (用户自备素材, 预留接口) |
| 4 | 技术栈 | Electron + TypeScript + React |
| 5 | 技能架构 | 插件式技能总线 + OpenAI-compatible Provider |
| 6 | Obsidian 集成 | 直接读写本地文件/`.base` |
| 7 | 待办行为 | 主动提醒 + 被动查询, 带规则保底 |
| 8 | 首版交互 | 待机动画链、点击、拖拽、右键菜单、气泡、托盘 |
| 9 | 行为驱动 | LLM 每轮决策 + 本地规则回退 |
| 10 | 首版技能集 | 对话 + Obsidian 待办 |
| 11 | 素材策略 | 借鉴 dsh-pet 管线自生成, 不从外部复制 |
| 12 | Fairy 动作 | 仅 GIF, 不生产额外动画 |
| 13 | 第二角色动作 | 首版最小动作集 + 对话气泡, 后续扩展 |
| 14 | 对话形态 | 气泡对话 + 可展开面板 |
| 15 | LLM Provider | 仅自定义 OpenAI-compatible, 不预置厂商 |
| 16 | Obsidian 写入 | 默认只读, AI 写回需确认 |
| 17 | 多角色运行 | 单宠运行, 设置内切换 |
| 18 | 应用常驻 | 托盘常驻 + 可选开机自启 |
