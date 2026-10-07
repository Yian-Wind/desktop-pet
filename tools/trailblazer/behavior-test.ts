// 垃圾桶长待机交互逻辑的无界面时序验证（esbuild 打包后用 node 运行）。
// 覆盖：点击=张望 → 张望中再点=跳出 → 快捷按钮=张望 → 张望窗口超时后点击=重新张望。
import { readFileSync } from 'node:fs'
import { BehaviorEngine } from '../../src/main/behavior-engine'
import type { PetPack, PetWindowState } from '../../src/shared/types'

const manifest = JSON.parse(readFileSync('packs/trailblazer/manifest.json', 'utf8'))
const corpus = JSON.parse(readFileSync('packs/trailblazer/corpus.json', 'utf8'))
const pack = { manifest, rootDir: 'packs/trailblazer', assets: {}, persona: null, corpus } as unknown as PetPack

let last: PetWindowState | null = null
const engine = new BehaviorEngine((s) => { last = s })
const snap = () => (last ? `action=${last.action} anim=${last.animationName ?? '-'}` : '(无)')
const t0 = Date.now()
const stamp = () => `[${String(Date.now() - t0).padStart(5)}ms]`

let allOk = true
const run = (label: string, fn: () => void, expect: string) => {
  fn()
  const got = snap()
  const ok = got === expect
  allOk = allOk && ok
  console.log(`${ok ? 'PASS' : 'FAIL'} ${stamp()} ${label} | 期望 ${expect} | 实际 ${got}`)
}

engine.start(pack)

run('1) 入睡（anim 由渲染端从 manifest.actions.sleep 解析）', () => engine.handle({ type: 'sleep' }), 'action=sleep anim=-')
run('2) 桶内首次点击 -> 顶盖张望（不跳出）', () => engine.handle({ type: 'wake' }), 'action=sleep anim=顶盖张望')
run('3) 张望期间再点击 -> 跳出炸开', () => engine.handle({ type: 'wake' }), 'action=idle anim=跳出炸开')
run('4) 再次入睡', () => engine.handle({ type: 'sleep' }), 'action=sleep anim=-')
run('5) 桶内快捷按钮 -> 顶盖张望', () => engine.handle({ type: 'cheer', payload: { text: '待办推荐' } }), 'action=sleep anim=顶盖张望')
run('6) 张望期间点击 -> 跳出炸开', () => engine.handle({ type: 'wake' }), 'action=idle anim=跳出炸开')

run('7) 入睡', () => engine.handle({ type: 'sleep' }), 'action=sleep anim=-')
run('8) 桶内拖动开始 -> 保持桶状态', () => engine.handle({ type: 'drag-start' }), 'action=sleep anim=-')
run('9) 桶内松手 -> 顶盖张望', () => engine.handle({ type: 'drag-end' }), 'action=sleep anim=顶盖张望')
run('10) 张望期间点击 -> 跳出炸开', () => engine.handle({ type: 'wake' }), 'action=idle anim=跳出炸开')

void (async () => {
  run('11) 入睡', () => engine.handle({ type: 'sleep' }), 'action=sleep anim=-')
  await new Promise((r) => setTimeout(r, 3400))
  run('12) 张望视觉结束(3.0s)后点击 -> 重新张望（非跳出）', () => engine.handle({ type: 'wake' }), 'action=sleep anim=顶盖张望')
  console.log(allOk ? 'ALL_PASS' : 'HAS_FAIL')
  process.exit(allOk ? 0 : 1)
})()
