# Spine 动画生态与「自然度」调研报告

> 调研日期：2026-09-08。数据（star 数、维护状态）为当日 GitHub/npm 抓取结果，可能随时间漂移。
> 背景：为 D:/pet 桌面宠物项目的 Spine 动画制作工具链选型做支撑——重点评估现有 agent/skill/MCP/拆分方案（开源+闭源），并针对「AI 生成的动画不自然」深挖技术路线。

---

## 0. TL;DR

- **官方（Esoteric Software）完全缺席 AI 化**：无 MCP、无 AI 功能、无受支持的编辑器自动化接口。官方认可的唯一路线是「导出 JSON → 外部修改 → 导入」。所有第三方方案被迫在两条窄路里二选一：封装 Spine Editor CLI（需正版 + 版本锁定）或裸写 JSON/二进制格式（兼容风险自担）。
- **MCP 层**：全网可确认 11 个开源 Spine MCP，全部早期个人项目（最高 100★ 仅 2 commit），无事实标准；npm 仅 1 个已发布包（锁死 3.8.75）。
- **Skill 层**：唯一成型的是 `spine-animation-ai`（413★，PolyForm 非商业许可），方向偏「生图→绑骨→生成动画」；**「拆分」与「动画打磨」方向的 Agent Skill 空白**，skill 市场（skillsmp / clawhub / skills.sh）零覆盖。
- **拆分工具层**：最成熟。图集拆图、动画导出 GIF/MP4、skel↔JSON 转换都有社区标准工具，但普遍无许可证或禁商用。
- **自然度**：AI 生成动画不自然的第一根源是 4.2 JSON wire format 的三个坑；官方 4.2 Physics 约束是二次运动的正规解；三个开源项目收敛出一套可复用的经验参数与 lint 指标（详见第 6 节）。

---

## 1. 本机现状（对照基线）

| 已有 | 说明 |
|---|---|
| `spine-mualani` skill | 官方 `@esotericsoftware/spine-webgl` 4.2.120 渲染、皮肤组合、动画切片、像素命中测试；含 `inspect_spine_json.js` 与参考渲染 harness（`tools/capture-reference.cjs`） |
| D:/pet 资产 | Mualani（4.2.35 JSON 骨架，246 骨骼、20 动画）、promeia_back 两套 Spine 包；全机无二进制 `.skel`，均为 JSON |
| 骨骼特征 | 大量发饰/衣物链（后发×6、辫子×18、短裙×17、鬓角×18、腰部装饰、后摆等）——physics 约束的理想候选；当前**无 physics 段** |
| MCP 配置 | codex/zcode 的 MCP 配置里无任何 spine 条目 |

**本机缺口**：无图集拆分工具、无动画→GIF/序列帧导出、无 spine MCP、不支持二进制 `.skel`、无渲染回归自动化。

## 2. 官方生态与边界

- **Spine Editor**（商业授权 $69/$299/$1499）。导出：JSON（standard/minimal）/ Binary(.skel) / PNG（序列帧）/ GIF / APNG / PSD（按帧分层）/ JPEG / AVI / MOV（透明通道）+ 内置 Texture Packer + CLI 自动化。**明确不支持按单动画导出数据**（per-skeleton 粒度）。
- **官方立场**（论坛 thread 29562，2025-12）：「Spine does not provide a supported automation interface that allows external tools or the CLI」；CLI 无法复现编辑器内部操作；认可的唯一边界是 JSON 导出→外部修改→导入（官方格式文档 https://esotericsoftware.com/spine-json-format ）。
- **官方 runtime**：spine-runtimes（5.3k★）各语言实现；npm `@esotericsoftware/spine-*` 4.3.13。**runtime 只读不写**，且许可证禁止用其代码写转换器再分发。
- **TexturePacker**（CodeAndWeb，闭源商业）：支持按 Spine atlas 格式打包（正向），无「导入 Spine atlas 重打包」功能。
- 竞品参照：Live2D/Rive 格式封闭故无拆分工具；DragonBones 格式明文故无拆分需求。Spine 拆分需求独特地源于「封闭二进制 + 商业编辑器」组合。

## 3. Spine MCP 盘点（11 个开源）

| 项目 | Star | 许可证 | 能力要点 | 锁定版本 |
|---|---|---|---|---|
| [ampersante/spine2d-animation-mcp](https://github.com/ampersante/spine2d-animation-mcp) | 100 | MIT | PSD→Spine 4.2 工程（skeleton+atlas 装箱），自述 Phase 0 POC，无动画能力；贡献了「轴心必须在关节边缘」的绑骨经验 | 4.2 |
| [zhoushengmin/spine-mcp-server](https://github.com/zhoushengmin/spine-mcp-server) | 1 | MIT | **npm 唯一发布包**，70 工具（动画/骨骼/皮肤/图集 split_atlas、Cocos 链路），导出→修改→原位导入+.bak 备份 | 3.8.75 Pro |
| [1425sd/spine-MCP](https://github.com/1425sd/spine-MCP) | 12 | Apache-2.0 | 封装官方 Spine CLI + 模板动画生成 + **语料库学习层**（统计真实 .spine 项目参数分布做推荐）；仅 Windows | 3.8.75 |
| [nihatcagri44/spine-motion-mcp](https://github.com/nihatcagri44/spine-motion-mcp) | 3 | MIT | 设计最完整：8 种参数化动画模板 + headless Chrome GIF 预览 + CLI 往返 + 性能 lint（easing.ts/templates.ts/lint.ts 是最佳参考实现） | 4.2 |
| [claudeskydream-hash/sky-spine-mcp](https://github.com/claudeskydream-hash/sky-spine-mcp) | 0 | MIT | 纯官方 CLI 只读封装 + 资产三件套配对校验（最接近 QA 类） | 需正版 |
| [yb901104-wq/spine-mcp](https://github.com/yb901104-wq/spine-mcp) | 0 | 无许可证 | 中文，4.1.24 动画时间线读写，dryRun+备份+沙箱安全设计突出 | 4.1.24 |
| [egorfedorov/spine-mcp](https://github.com/egorfedorov/spine-mcp) | 0 | MIT | 纯 Python 绑骨+图集打包，**无需 Spine 许可证**，支持 4.2/4.3 | 4.2/4.3 |
| [K-ulucay/spine_anim_mcp](https://github.com/K-ulucay/spine_anim_mcp) | 0 | MIT | 确定性数学函数生成器（拒绝生成式姿势），2-bone 解析 IK 足部锁定 | 4.2 |
| claudeskydream-hash/spine2D-mcp、Attrom/spine-mpc-attrom（研究稿）、SolarisNeko/neko233 | 0–8 | 混合 | PSD 导入 / 27 工具设计文档 / 无法评估 | — |

目录站收录：glama.ai 9 个、mcp.so 3 个、smithery ≈ 0、PyPI 0 个。**无事实标准，分发近乎空白。**

## 4. Agent / Skill 现状

- **[GenielabsOpenSource/spine-animation-ai](https://github.com/GenielabsOpenSource/spine-animation-ai)**（413★，活跃，**PolyForm Noncommercial**）：唯一成型的 Spine Claude Skill。参考图→SIFT+RANSAC 自动摆位绑骨→生成 Spine JSON→预设动画（12 动画原则落地为：相关骨骼关键帧时间错开、幅度随层级递减、循环必须回起点）→Web Player 预览；附 Gemini 拆部件与换皮。SKILL.md 有 4.2 wire format 完整踩坑记录（高价值）。
- **[spine-rigc](https://www.npmjs.com/package/spine-rigc)**（npm，MIT，2026-09 新发布）：反向思路——「给 AI Agent 用的绑骨编译器」，声明式 rig 规范→Spine 4.3 数据，经 spine-core 往返校验。
- JustIkra/Slot-spine-skin、Slot-gen-skill（老虎机方向，1★）；skillsmp / clawhub / skills.sh 市场零覆盖；无 Cursor rules、无 GPTs。

## 5. 「拆分」类工具

**图集（atlas）拆图还原：**

| 工具 | Star | 语言 | 特点 |
|---|---|---|---|
| [qcdong2016/PlistDumper](https://github.com/qcdong2016/PlistDumper) | 151 | Go | 通用拆图器（plist/json/fnt/Spine atlas），中文社区事实工具，处理 trim/rotate，有预编译版 |
| [Rin-Wood/SpineAtlas](https://github.com/Rin-Wood/SpineAtlas)（PyPI `SpineAtlas`） | 21 | Python | 质量最高的专门库：旋转帧、trim、多页、premultiplied alpha、3.0/4.0 格式互转 |
| [Nattsu39/spine-exporter](https://github.com/Nattsu39/spine-exporter)（npm） | 51 | TS | 无头 Node CLI 导出 GIF/PNG 序列/MOV，内附拆图器（3.8.x） |

**动画级导出：** [ww-rm/SpineViewer](https://github.com/ww-rm/SpineViewer)（522★，C#，Spine 2.1–4.2，导出 PNG/GIF/MP4/分层 PSD，中文生态主力，⚠️无许可证）、[kiletw/SpineViewerWPF](https://github.com/kiletw/SpineViewerWPF)（221★，2.1.08–4.1.00，⚠️无许可证）。

**格式转换：** [wang606/SpineSkeletonDataConverter](https://github.com/wang606/SpineSkeletonDataConverter)（399★，skel↔JSON 双向 + 3.5–4.2 全版本互转的事实标准，⚠️PolyForm 非商业）、[BastienGimbert/SkelToJson](https://github.com/BastienGimbert/SkelToJson)（MIT，支持 4.2.x/4.3.x）。

**空白**：npm 无成熟 atlas 拆图包；「单动画数据级拆分」完全空白（仅 2015 年一个 0★ 项目沾边）；4.2/4.3 拆图支持薄弱；商用合规链路缺乏（主流工具无许可证或禁商用）。

## 6. 自然度专项：让 AI 生成的 Spine 动画变自然

### 6.1 第一根源：4.2 wire format 三个坑（已对本机 4.2.120 源码验证）

以下结论直接读 `D:/pet/node_modules/@esotericsoftware/spine-core@4.2.120` 的 `SkeletonJson.js` / `Animation.js` 确认：

1. **4.x 旋转关键帧用 `"value"` 而非 3.8 的 `"angle"`**。`readTimeline1` 只读 `getValue(keyMap, "value", defaultValue)`；写成 angle 会被读成默认值 0 → 动画僵硬/无效果。
2. **bezier 控制点是每属性一条**：`readCurve` 中 `i = value << 2`。rotate（单属性）curve = **4 个数**；translate/scale（x/y 双属性）curve = **8 个数**（前 4 个是 x 的控制点、后 4 个是 y 的）；给 4 个会让 y 读到 undefined → NaN 传染整帧消失。RGBA color timeline 是 16 个数。
3. **控制点是绝对坐标**（时间秒 + 值），不是归一化的。`setBezier` 里 cx/cy 直接与 time1/value1 同量纲参与多项式运算。本机 mualani.json 的 2288 个 curve 数组全部印证（例：`time:0.3333, value:-2.14, curve:[0.433,-2.14,0.533,1.37]`）。归一化→绝对换算：`cx = t1 + (t2-t1)*px; cy = v1 + (v2-v1)*py`。
4. 补充事实：curve 写在关键帧 N 上，管辖 N→N+1 段；首关键帧可省略 `time`（默认 0）和 `value`（默认 setup pose 值，rotate/translate 为 0，scale 为 1）；`"curve":"stepped"` 为阶跃。
5. **动画内 physics 时间线的 wire shape（本次实测踩坑）**：正确形状是 `"physics": { "<约束名>": { "reset": [ { "time": 0 } ] } }`（约束名 → 时间线名 → 关键帧数组）；写成 `{"约束名": [{"time":0,"reset":true}]}` 会被 4.2.120 解析器**静默忽略**（for-in 遍历把数组下标当时间线名，不匹配 reset/inertia/… 分支直接 continue，不报错）。

### 6.2 官方 4.2 Physics 约束（二次运动的正规解）

- 官方文档 https://esotericsoftware.com/spine-physics-constraints ，博客 "Spine 4.2: The physics revolution"。
- 只有**一种**物理约束类型，Inertia/Strength/Damping/Mass/Wind/Gravity 是属性：Inertia=骨骼运动传给偏移的比例；Strength=拉回原姿势；Damping=抑制振荡；Mass=加速度阻力；Wind/Gravity=世界 X/Y 恒力；Mix 可 K 帧。Setup 滑条：Translate X/Y、Rotation、Shear X、Scale X；Limit（平移最大速度，默认 5000）；FPS 官方建议 30–60。
- 定位：头发/尾巴/衣物/披风**零关键帧**获得持续二次运动，且跨动画持续反应（角色移动时也摆动）。**呼吸不会由物理自动产生**（物理是被动摆动），需主动 K 帧。
- **循环动画不要勾 Deterministic**（官方明说可能造成结尾跳变）。
- 4.2 JSON 段（已对 4.2.120 `SkeletonJson.js` 解析代码验证）：顶层数组 `physics`，每项 `{name, order, skin, bone(单骨骼), x, y, rotate, scaleX, shearX, limit, fps, inertia, strength, damping, mass, wind, gravity, mix, *Global 标志}`，默认 limit=5000、fps=60、inertia=1、strength=100、damping=1、mass=1、mix=1；JSON 写 `mass`，运行时取倒数存 `massInverse`。
- 动画可 K 帧物理属性：`"physics": {"约束名": [{"time":0, "reset":true, ...}]}`（reset/inertia/strength/damping/mass/wind/gravity/mix 各有时间线）。**换动画时对头发类骨骼发 reset 防止物理残留跳变**（骨骼级 Physics 枚举：none/reset/update/pose）。
- 模拟核心公式（可参考做程序化叠加）：`xVelocity += (wind - xOffset*strength) * massInverse * step; xOffset += xVelocity * step;` 阻尼按 `damping^(60*step)` 衰减。
- 官方教程系列："Animating with Spine" #6 Arcs（弧线）/ #7 Anticipation（预备）/ #8 Follow-through and overlapping action；Spine Tips #8 Physics setup、#7 Muscle setup。论坛精华：#7287（发链二次运动两路线：transform 约束偏移法 vs 运行时物理，后者易 "too bouncy"）、#15805（timing offset 曲线）、#4131（程序化 rebound 先例）。

### 6.3 三个开源项目收敛的「经验参数」（可直接作默认值）

| 主题 | 收敛参数 | 来源 |
|---|---|---|
| 呼吸 idle | 周期 1.6–2.4s；胸口 scale 幅度 1–2%（上限 5%）；多骨骼相位错开：torso 相位 0.5、neck 0.55、head 0.6 | spine-animation-ai gen_idle、spine-motion-mcp idle_breath、K-ulucay |
| follow-through | head 滞后 torso 约 15% 周期；幅度随层级递减 hip>torso>head | 三项目一致 + 官方教程 #8 |
| walk | 腿反相正弦；臂摆=腿摆 60%；躯干 bob 用 2 倍频、最低点在 passing position（0.25/0.75）；stride ≤0.7 腿长、抬脚 ≤0.2 腿长（IK 可达域）；run 加 5–8° 前倾 | K-ulucay ik.py、spine-motion-mcp walk_cycle |
| 眨眼 | 周期 2.5–5s 随机化、闭眼 0.1s、相位放 55% 处（避免机械感） | spine-motion-mcp blink |
| 大动作 | windup 占 35% 时长（"The wind-up sells the hit"）；打击帧用 snapOut（0.05,0.7,0.1,1）；回弹 overshoot（0.34,1.56,0.64,1） | spine-motion-mcp attack_swing/hit_react |
| 缓动预设 | ease(0.25,0,0.75,1)、overshoot/back-out(0.34,1.56,0.64,1)、anticipation/back-in(0.36,0,0.66,-0.56)、snapIn(0.55,0,0.85,0.25)、snapOut(0.05,0.7,0.1,1)；cy 可超 [0,1] 产生过冲/回拉 | spine-motion-mcp easing.ts、spine-animation-ai |
| K-ulucay 走路细节 | 上腿不对称正弦（前摆 1.0、后摆 0.6 系数）、小腿 -(8+35*swing)、脚 ±12°/16° 生物力学角度、hip bob=-bob*|sin| | spine_anim_mcp generators.py/ik.py |

### 6.4 质量 lint 指标

- **性能/卫生**（spine-motion-mcp lint.ts，最完整先例）：骨骼预算 60、关键帧密度 >30/秒/timeline 告警（提示"像烘焙曲线，改用 bezier"）、loop-pop（首尾关键帧值不同告警）、deform 开销、draw-order churn >3、clipping 附件计数。
- **平滑度学术指标**：SPARC（谱弧长，PMID 22180502）、LDLJ（对数无量纲 jerk，PMID 36294017；综述 PMID 30258393）；现成小实现 [Jason-Dellai/Smoothness-Metrics](https://github.com/Jason-Dellai/Smoothness-Metrics)。落地：时间线按 60fps 插值采样→数值微分求 jerk→RMS 打分。
- **阈值必须用本机专业动画校准（本次实测）**：绝对 jerk RMS 无意义（幅度不同不可比）。以 mualani 库 257 条手调 rotate 时间线实测，**jerk RMS / 摆幅** 的分布为 p10≈42k、p50≈99k、p75≈129k、p90≈309k；lint 告警线取 200k（介于 p75 与 p90 之间）。用绝对阈值 5000 会把专业动画全部误报。
- 未找到专门针对骨骼动画的现成 lint 工具（空白）。

### 6.5 视觉迭代闭环

- spine-motion-mcp：headless Chrome + 官方 spine-player 渲染 GIF → agent 看图迭代 → `keys_set` 精修 → `loop_smooth` 修循环跳变。
- spine-animation-ai：官方 Spine Web Player HTML5 预览。
- 本机已有等价物：D:/pet `tools/capture-reference.cjs`（Electron + spine-webgl 4.2 离屏渲染出图）。注意本机约束：agent 不看图，出图后交用户目视确认。

### 6.6 AI 动捕 / 视频转动画（关键帧来源，现状不成熟）

| 工具 | 输出 | 结论 |
|---|---|---|
| DeepMotion Animate 3D | FBX/BVH/GLB | 仅 3D 人形，credit 制 |
| QuickMagic | FBX/BVH 等 | Free plan；"other 2D/3D pipelines" 但未明确 Spine |
| Rokoko Video | FBX 免费（BVH 需 $10–12/月） | 仅 3D；免费 30 秒/月 |
| Cascadeur | FBX 等 | 免费版禁商用；纯 3D |
| facebookresearch/AnimatedDrawings | 12.8k★已归档 | 图像→自动绑骨→**任意 BVH 重定向**到 2D 角色，是「3D 动作→2D 贴图骨骼」的最佳参考链路，缺的只是 Spine JSON 导出器 |

端到端「视频→Spine JSON」开源项目**不存在**（搜过 video to spine / pose to spine / mediapipe spine / openpose 2d retarget）。侧面视角下可把 BVH 关节角映射到 Spine rotate 时间线，但管线长，短期不推荐。

### 6.7 技术路线按见效快慢排序

| 序 | 路线 | 见效 | 落地方式 |
|---|---|---|---|
| 1 | 正确 4.2 wire format + bezier 预设库 | 立即（不修就是 NaN/僵硬根源） | 固化换算函数 + 命名预设 |
| 2 | 循环规范（frame0==frameN、loop-pop 检测、禁 Deterministic） | 立即 | 生成器强制 + lint 规则 |
| 3 | 参数化模板 + 经验默认值（6.3 表） | 天 | 复刻 templates.ts + 强度档 |
| 4 | 错相/滞后制造 follow-through | 天 | 模板内置相位偏移参数 |
| 5 | physics 约束自动注入 + 换动画 reset | 周 | 生成 physics JSON 段 |
| 6 | 视觉迭代闭环（渲染 GIF→用户确认） | 周 | spine-player/已有 harness |
| 7 | 2-bone 解析 IK 足锁 | 周-月 | walk/run 走 IK 分支 |
| 8 | 质量 lint 双轨（性能 + 平滑度） | 周-月 | lint 模块 + SPARC/LDLJ |
| 9 | Corpus learning（从真实 .spine 学参数分布） | 月 | 1425sd 路线 |
| 10 | 视频动捕关键帧 | 月 | BVH→角度映射 |

## 7. 空白点清单（自建工具的机会面）

1. 「拆分」与「动画打磨」方向的 Agent Skill 不存在。
2. 单动画数据级拆分空白；npm 无成熟 atlas 拆图包。
3. 版本碎片化（各工具分别锁死 3.8/4.1/4.2），无跨版本统一方案；4.2/4.3 支持薄弱。
4. 运行时资产 QA/校验/预览类 MCP 空白（三件套配对校验 + 真实渲染预览）。
5. 许可证合规雷区普遍（无许可证 / PolyForm 禁商用）。自建应：基于 spine-ts 只读校验（合法）+ 自写 MIT 解析器做拆图。
6. 引擎桥接空白：unity-mcp（14k★）/ godot-mcp（5.6k★）均不支持 Spine。

## 8. 对本项目的决策

- **优先做 skill**（迭代快、无需服务），MCP 化第二步。已建 `spine-anim` skill：4.2 正确格式写入器 + 参数化模板（经验默认值）+ physics 注入 + lint + 预览出图（沿用"agent 不看图"约束）+ dryRun/备份的应用器。
- 与 `spine-mualani` skill 边界：spine-anim 管**动画数据**（生成/打磨/lint/物理注入），spine-mualani 管**该资产渲染与项目细节**。
- 拆分类需求（图集拆图/格式转换）直接复用现成工具（PlistDumper/SpineAtlas/wang606），不重复造轮子。
