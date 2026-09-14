#!/usr/bin/env node
// 把普罗米娅的大腿从 body 重挂到 root（补偿 x/y 保持世界位置不变）：
// body 的待机摆动（loop/loop背手 的 rotate）不再带动腿——腿部绝对固定。
// 前提（已验证）：body setup 无旋转/缩放/剪切，且所有动画都没有腿骨关键帧。
// 用法：node tools/promeia/fix_leg_parents.cjs [--apply]（默认 dry-run）

const fs = require('node:fs')
const path = require('node:path')

const FILE = path.resolve(__dirname, '..', '..', 'packs', 'promeia_back', 'promiya_back.json')
const apply = process.argv.includes('--apply')

const skeleton = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const bones = skeleton.bones
const body = bones.find((b) => b.name === 'body')
if (!body) throw new Error('body bone not found')
if (body.rotation || body.scaleX || body.scaleY || body.shearX || body.shearY) {
  throw new Error('body has non-trivial setup transform — pure-translation compensation invalid')
}
// 任何动画关键帧落在腿骨上都会因父级变化而改变世界效果，必须先排除
for (const [name, anim] of Object.entries(skeleton.animations)) {
  const keyed = anim.bones ? Object.keys(anim.bones) : []
  if (keyed.some((b) => /thigh|shin/.test(b))) {
    throw new Error(`animation "${name}" keys leg bones (${keyed.join(', ')} — unsafe to reparent`)
  }
}

for (const name of ['thigh_l', 'thigh_r']) {
  const thigh = bones.find((b) => b.name === name)
  if (!thigh) throw new Error(`${name} not found`)
  if (thigh.parent !== 'body') {
    console.log(`${name}: parent already "${thigh.parent}" — skip`)
    continue
  }
  const oldLocal = { x: thigh.x ?? 0, y: thigh.y ?? 0 }
  thigh.parent = 'root'
  thigh.x = oldLocal.x + (body.x ?? 0)
  thigh.y = oldLocal.y + (body.y ?? 0)
  console.log(`${name}: body(${oldLocal.x}, ${oldLocal.y}) -> root(${thigh.x}, ${thigh.y})`)
}

if (!apply) {
  console.log('dry-run — re-run with --apply to write')
  process.exit(0)
}
fs.writeFileSync(FILE, JSON.stringify(skeleton))
console.log('written:', FILE)
