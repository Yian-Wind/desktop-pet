# 冲浪下板动画优化 — 实现记录（2026-09-05 更新）

对应 TODO.md 待排期第 2 条：优化冲浪滑行末尾姿态与原地跳下冲浪板姿态之间的连续性。**已实现并经用户验收（"效果很不错"）。**

## 最终方案（SpinePetVisual.tsx）

四段序列，全部为运行时切片（不改 mualani.json）：

| 段 | raw 切片 | 方向 | 说明 |
|---|---|---|---|
| 出场 | 0→2.8333 | 正放 | 跳上板、向右滑出 |
| 滑回 | 3.3333→5.952 | 正放 | 切点按刹车速度连续条件解出 |
| 刹车 | 1.2333→1.8333 | 正放 | 借用"落板站稳"切片（板全亮、无跳起动作），T=0.6s 程序化缓刹 |
| 下板 | start=9.3333−1.8333=7.5 | 倒放 | 采样 raw 1.8333→0，与刹车末帧同帧无缝；自带下蹲蓄力→起跳→落地 |

### 关键标定（scale=1.1 窗口 760×952 CSS，zoom=1.3637）

- 可见世界 x 范围 [−422, +615]；原地（idle）世界 x≈3.6（屏幕 x 312/760）
- T=0.6 缓刹：滑回区间贝塞尔近线性 v≈1292，x(t_c)=−256 → **t_c=5.952**，D=v·T/3=260
- 刹车位置采用 **pin 式补偿**：首帧捕获角色世界位置 (x0,y0)≈(−256, 68.3)，目标轨迹 easeOutCubic 从 (x0,y0) 减速到 rest (3.61, 69.17)，每帧 `root.x += target − (root.x + bone.x)`（y 同理加 baseSkeletonY）。**插值系数必须是 `ease`（p=0 在切点、p=1 在原地）——写反成 `1−ease` 会变成"起点瞬跳原地再倒退回切点"，正是"冲过头弹回来"的来源**
- **root translate y=18.97 只在 raw≥3.3333 生效**（滑行段整体抬高），站稳/下板切片原生没有 → 常数 SURF_BRAKE_REST_Y_UNITS=69.17 已含抬升
- 刹车切片 mixDuration=0.12 柔化滑回→刹车的姿态瞬切；pin 式补偿保证 mix 过渡中位置仍精确
- 下板段板 alpha：progress<0.3 全亮，0.3→0.5 线性淡出——与正放"板在人落板途中淡入"对称；素材固有轨道里跳跃时板留在水面（鲨鱼 bone 是 root 直接子骨骼，不随人跳跃）
- 下板段延续滑行抬升 18.97，落地段（progress 0.45→0.61）线性淡出

### 点击打断

冲浪播放中再点击会走普通点击路径：`clearTrack(0) + setToSetupPose() + surfBrake=null + setAnimation(随机动画)`，角色瞬回原地播放随机动画（日志实测打断链正常）。

## 已踩过的坑（勿回退）

1. **刹车不能用 0.8333→1.2333 切片**：该段是"空中落板+板淡入"，观感=重复跳上板（用户实测反馈）。
2. **pin 目标插值方向**：`target = x0 + (REST−x0)·easeOutCubic(p)`——写反成 `(1−ease)` 会让刹车起点瞬跳到原地再倒退回切点（用户："冲过头弹回来"）。
3. 刹车 elapsed≥T 后必须保持满抬升直到下板条目接管，否则有一帧 19 单位突降（已并入 phase 切换逻辑）。
4. 下板倒放采样：applyTime = duration − min(trackTime+animationStart, animationEnd)，animationStart=7.5 → raw 1.8333→0。
5. addAnimation delay>0 语义 = 前一条目 trackLast ≥ delay 时切换；mixDuration>0 时 pin 补偿仍精确（每帧按原生局部值修正）。
6. 冲浪 complete listener 依赖 `currentAction==='surf' && !entry.reverse` 跳过非倒放条目的 complete。
7. 诊断日志读 bone.worldX 是上一帧 updateWorldTransform 的滞后值，勿当本帧 native 用。

## 工具与钩子

- `tools/surf-calibrate.cjs/.html`：确定性帧捕获校准 harness（复刻应用相机/序列/补偿逻辑），query 参数 `mode/t/re/off/bs/be/bt/ly/ys`；输出逐帧 PNG + 数值诊断。
- `SURF_TEST=1 npm run dev`：宠物窗口加载 2s 后自动播一次冲浪（`?forceSurf=1`），端到端验收用。
- 渲染进程 console 需 `--enable-logging` 才进终端。
- 屏幕连拍验收注意：宠物窗口物理坐标随用户拖动变化，且 ZCode 聊天页面可能贴有同款鲨鱼板图片，勿误判为宠物渲染。

## 验证状态

- `npm run typecheck` + `npm run build` 通过（2026-09-05）。
- harness 帧序列 + 应用端到端连拍：缓刹无过冲、刹停原地、下板跳跃+板淡出正常。
- 点击打断链日志实测正常（打断后原地播随机动画）。
- 用户验收："现在效果很不错"（2026-09-05）。
