# 预案：待机后 loading 卡死 + 透明区域阻断点击

状态：当前版本未复现（2026-09-10 记录）。本文档为已完成的排查结论与快速修复
预案，问题再次出现时按此执行。所有 file:line 已对照源码核实。

## 症状

- 宠物待机一段时间后，原位置只显示 "loading" 字样
- 一块远大于精灵的透明区域挡住桌面鼠标点击（窗口失去穿透）
- 任务管理器里观察到"多出来的 electron 进程"

## 结论速览（回答"是否有程序强启第二实例"）

**没有。** 全库（src/main）无 spawn/child_process/fork/app.relaunch/autoUpdater。
单实例锁实现正确（`src/main/index.ts:18-25`：后启动者 `app.quit()`，先启动者只
focus 宠物窗，不创建任何新东西）。

任务管理器里的多进程是 Chromium 正常子进程：
- GPU 进程（**最相关**：长时间渲染后会重置/重生）
- network utility 进程
- 启动即创建的**隐藏面板窗口渲染进程**（`src/main/index.ts:48`）

## 根因链（按依赖顺序）

1. **GPU/上下文故障的诱因**：睡态刃舞几乎连续渲染（25s 动画 + 5s 间隔循环），
   长时间负载后 GPU 进程重置 → WebGL 上下文丢失
   （`src/renderer/renderers/SpinePetVisual.tsx` **无** `webglcontextlost` 处理）。
2. **loading 永驻**：`src/renderer/hooks/usePet.ts:18-31` 的 init
   （getConfig → listPacks → getPetState）**无错误处理无重试**——
   任何一次 invoke 失败即永久 `pack/state = null`
   → `src/renderer/components/PetWindow.tsx:110-111` 渲染 loading div。
3. **点击阻断死锁（设计缺陷，症状主因）**：
   - 窗口创建时**默认不穿透**（`src/main/windows.ts:29-65` 从不调
     setIgnoreMouseEvents）
   - loading 视图 early return **剥离全部指针处理器**（`PetWindow.tsx:110-112`）
   - cursorWatch 只在穿透态运行（`windows.ts:96-115`），非穿透态无任何看门狗
   - ⇒ loading + 阻断 = **无任何自动恢复路径**
   - 窗口远大于精灵（`PET_UI_MARGIN_RATIO 0.58` + 最小垂直边距 300，
     `windows.ts:8-10`）→ "大范围透明挡桌面"
4. **全程无监控**：主进程零 `render-process-gone` 处理器；
   main/renderer 均无全局异常处理 → 一切静默，日志无痕。

## 临时手动恢复（问题当下出现时）

1. 任务管理器结束全部 electron.exe，重跑 `start-pet.bat`。
2. 若怀疑单个渲染进程僵死：只杀该渲染 PID（命令行列含 `--type=renderer` 且
   非面板进程）——注意当前无看门狗，渲染进程死后窗口白屏，只能整组重启。

## 快速修复预案（按优先级，互相独立可单独落地）

### 修复 1：loading 态安全化（最小改动、收益最大，优先做）

`src/renderer/components/PetWindow.tsx`：loading/错误视图（hit-test 不可用期间）
主动 `applyPetClickThrough(true)` 让整窗穿透——**坏状态永不挡桌面**。
就绪后由现有 hit-test 流程接管恢复交互。

### 修复 2：usePet init 健壮化

`src/renderer/hooks/usePet.ts:18-31`：try/catch + 指数退避重试
（1s/3s/10s，之后每 30s 直到成功），失败 console.error——
瞬时 IPC 失败自愈，loading 不再永久。

### 修复 3：崩溃/重载看门狗（主进程）

- `src/main/windows.ts` 或 `index.ts`：pet 窗口 `render-process-gone` →
  console.error 记录原因 + `webContents.reload()`
- `did-finish-load` → 重新推送当前 `pet:state`（渲染端 init 自愈兜底）
- `process.on('uncaughtException'/'unhandledRejection')` 日志

### 修复 4：WebGL 上下文恢复

`SpinePetVisual.tsx`：监听 `webglcontextlost`（preventDefault + 置 not-ready），
`contextrestored` 或丢失后强制重建 spine canvas（重跑资源加载），
hit-test 随 ready 重新接线。

### 修复 5：渲染端全局错误日志

`window.onerror` + `unhandledrejection` → console.error（随 electron stdout
进 `tools/tmp/pet_run.log`），复现时可直接定位。

## 常用命令

```bash
# 重启应用（bash）
for pid in $(tasklist | grep -i electron | awk '{print $2}'); do taskkill //PID $pid //F; done
sleep 2 && npx electron out/main/index.js > tools/tmp/pet_run.log 2>&1 &

# 查进程树（父 PID/创建时间，判断哪个是后生的）
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" |
  Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | Sort-Object CreationDate"
```

## 复现时要收集的证据（进 `tools/tmp/pet_run.log`）

1. 出现时刻前后的 `[idle-show]` 日志（行为引擎诊断，已在 `behavior-engine.ts`）
2. 渲染进程 PID 与创建时间（确认是否重生 = GPU 重置或崩溃重载）
3. 主进程 stdout 是否有 render-process-gone / uncaught 输出
   （当前无监听 = 无输出；落地修复 3/5 后此日志才有内容）
