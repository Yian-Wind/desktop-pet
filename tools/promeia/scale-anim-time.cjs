#!/usr/bin/env node
// 等比缩放一个动画的时间轴（关键帧 time 与贝塞尔曲线时间分量），用于延长
// 循环周期（如 发光呼吸 与待机 loop 同步减速）。
// 用法：node tools/promeia/scale-anim-time.cjs <skeleton.json> <animName> <factor> [--apply]
// 默认 dry-run；--apply 直接写回（请先自行备份）。

const fs = require('node:fs')

const [file, animName, factorArg, ...rest] = process.argv.slice(2)
const factor = Number(factorArg)
if (!file || !animName || !(factor > 0)) {
  console.error('usage: scale-anim-time.cjs <skeleton.json> <animName> <factor> [--apply]')
  process.exit(1)
}
const apply = rest.includes('--apply')

const skeleton = JSON.parse(fs.readFileSync(file, 'utf8'))
const anim = skeleton.animations?.[animName]
if (!anim) throw new Error(`animation "${animName}" not found`)

const scaleKeys = (keys) => {
  if (!Array.isArray(keys)) return keys
  return keys.map((k) => {
    if (!k || typeof k !== 'object' || typeof k.time !== 'number') return k
    const out = { ...k, time: k.time * factor }
    if (Array.isArray(out.curve)) {
      // 4/8 长（rotate/alpha 与 translate）曲线的 x 分量都在 i%4∈{0,2}
      out.curve = out.curve.map((c, i) => (i % 4 === 0 || i % 4 === 2 ? c * factor : c))
    }
    return out
  })
}

const walkTimelines = (group) => {
  if (!group || typeof group !== 'object') return 0
  let count = 0
  for (const timelines of Object.values(group)) {
    if (!timelines || typeof timelines !== 'object') continue
    for (const [tl, keys] of Object.entries(timelines)) {
      if (Array.isArray(keys)) { timelines[tl] = scaleKeys(keys); count++ }
    }
  }
  return count
}

let total = 0
// bones/slots 直接是 {bone: {rotate: keys}} 形态；attachments 要走到
// [skin][slot][attachment] 才是 {deform: keys}
if (anim.bones) total += walkTimelines(anim.bones)
if (anim.slots) total += walkTimelines(anim.slots)
if (anim.attachments) for (const skins of Object.values(anim.attachments))
  for (const slots of Object.values(skins)) for (const atts of Object.values(slots)) total += walkTimelines(atts)

const lastKey = (anim.slots?.ponytail_illuminate?.alpha ?? [])
console.log(`${animName}: scaled ${total} timelines ×${factor}`)

if (!apply) {
  console.log('dry-run — re-run with --apply to write')
  process.exit(0)
}
fs.writeFileSync(file, JSON.stringify(skeleton))
console.log('written:', file)
