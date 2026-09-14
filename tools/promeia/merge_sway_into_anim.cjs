#!/usr/bin/env node
// 把待机摆动循环（loop）的时间线铺进一个长动画（如 刃舞 25s），让表演期间
// 身体保持与解背手待机一致的浮动。
//   - 目标动画已关键的时间线（如 刃舞 的右臂链）跳过，不冲突
//   - 循环首末帧值相同（loop 构造保证），逐周期平铺；最后一段不足一个周期
//     时压缩到剩余时长，收尾值 = 循环首帧值 —— 表演结束无缝交接待机基底
// 用法：node tools/promeia/merge_sway_into_anim.cjs <skeleton.json> <swayAnim> <targetAnim> [--apply]

const fs = require('node:fs')

const [file, swayName, targetName, ...rest] = process.argv.slice(2)
if (!file || !swayName || !targetName) {
  console.error('usage: merge_sway_into_anim.cjs <skeleton.json> <swayAnim> <targetAnim> [--apply]')
  process.exit(1)
}
const apply = rest.includes('--apply')

const skeleton = JSON.parse(fs.readFileSync(file, 'utf8'))
const sway = skeleton.animations[swayName]
const target = skeleton.animations[targetName]
if (!sway) throw new Error(`sway animation "${swayName}" not found`)
if (!target) throw new Error(`target animation "${targetName}" not found`)
if (!sway.bones) throw new Error(`sway animation "${swayName}" has no bone timelines`)

// 目标动画时长 = 其所有关键帧的最大 time
let duration = 0
const scanKeys = (keys) => {
  if (Array.isArray(keys)) for (const k of keys) if (k && typeof k.time === 'number') duration = Math.max(duration, k.time)
}
for (const tls of Object.values(target.bones ?? {})) for (const keys of Object.values(tls)) scanKeys(keys)
for (const tls of Object.values(target.slots ?? {})) for (const keys of Object.values(tls)) scanKeys(keys)
if (target.drawOrder) scanKeys(target.drawOrder)
for (const skins of Object.values(target.attachments ?? {}))
  for (const slots of Object.values(skins)) for (const atts of Object.values(slots)) for (const keys of Object.values(atts)) scanKeys(keys)
if (duration <= 0) throw new Error('target animation duration is zero')

// 循环周期长 = sway 所有关键帧的最大 time
let cycle = 0
for (const tls of Object.values(sway.bones)) for (const keys of Object.values(tls)) scanKeys.call(null, keys)
for (const tls of Object.values(sway.bones)) for (const keys of Object.values(tls)) {
  if (Array.isArray(keys)) for (const k of keys) if (k && typeof k.time === 'number') cycle = Math.max(cycle, k.time)
}
if (cycle <= 0) throw new Error('sway cycle length is zero')

// 平铺一组关键帧：把 [0, duration] 均分为 N 段（N=ceil(duration/cycle)），每段
// 完整播放一个摆动周期（时间统一缩放到段长）。全程匀速（无末段加速），
// 每段边界值=周期首帧值（loop 构造保证首末同值），末值与待机基底首帧一致。
// 注意：t=0 的关键帧在 JSON 里不写 "time"（undefined）——必须按 0 参与运算，
// 否则 NaN 序列化成 null、运行时读作 0，所有段的首帧会被去重坍缩成一个
// 携带错误曲线坐标的坏键（表现为周期起点跳变）
const tileKeys = (keys) => {
  const segments = Math.ceil(duration / cycle - 1e-6)
  const segLen = duration / segments
  const scale = segLen / cycle
  const out = []
  for (let i = 0; i < segments; i++) {
    const offset = i * segLen
    for (const k of keys) {
      const kt = typeof k.time === 'number' ? k.time : 0
      const key = { ...k, time: kt * scale + offset }
      if (key.curve) {
        key.curve = key.curve.map((c, j) =>
          j % 4 === 0 || j % 4 === 2 ? c * scale + offset : c
        )
      }
      out.push(key)
    }
  }
  // 去掉相邻周期交界处重复 time 的关键帧（保留后者）
  const seen = new Map()
  for (const k of out) seen.set(Number(k.time.toFixed(4)), k)
  return [...seen.values()].sort((a, b) => a.time - b.time)
}

target.bones ??= {}
let merged = 0
for (const [bone, tls] of Object.entries(sway.bones)) {
  const existing = target.bones[bone]
  for (const [tl, keys] of Object.entries(tls)) {
    if (existing && existing[tl]) {
      console.log(`skip ${bone}.${tl}: target already keys it`)
      continue
    }
    ;(target.bones[bone] ??= {})[tl] = tileKeys(keys)
    merged++
    console.log(`merge ${bone}.${tl}: ${target.bones[bone][tl].length} keys, ${Math.ceil(duration / cycle)} segments × ${(duration / Math.ceil(duration / cycle)).toFixed(2)}s`)
  }
}
console.log(`merged ${merged} timelines`)

if (!apply) {
  console.log('dry-run — re-run with --apply to write')
  process.exit(0)
}
fs.writeFileSync(file, JSON.stringify(skeleton))
console.log('written:', file)
