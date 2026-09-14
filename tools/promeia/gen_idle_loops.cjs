#!/usr/bin/env node
// 生成普罗米娅的两套待机摆动循环（与玛拉妮 loop 相同的节奏/曲线/幅度）：
//   loop      —— 解背手（正常站姿）待机：身体/头/马尾/双臂链摆动
//   loop背手  —— 背手站姿待机：去掉手臂浮动（双手固定背后），其余同 loop，
//                并携带 背手 末帧的大衣淡入 + 网格变形 + 手臂/马尾基础角
//
// 数值来源：packs/mualani/mualani.json 的 loop（骨骼映射见 BONE_MAP），
// 保证两包待机观感一致。马尾无 physics 跟随，幅度 ×1.5 补偿。
// 用法：node tools/promeia/gen_idle_loops.cjs [out.json]（默认 tools/tmp/promeia-idle-loops.json）

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const MUALANI = path.join(ROOT, 'packs', 'mualani', 'mualani.json')
const PROMEIYA = path.join(ROOT, 'packs', 'promeia_back', 'promiya_back.json')
const OUT = process.argv[2] || path.join(ROOT, 'tools', 'tmp', 'promeia-idle-loops.json')

const PONYTAIL_GAIN = 1.5
// 整体摆动增益：玛拉妮原值直接移植观感偏大（普罗米娅站姿更挺拔、腿外露），
// 全骨骼统一收小；调幅度改这里重跑即可
const SWAY_GAIN = 0.6
// 整体减速因子：时间轴统一拉伸（关键帧 time 与贝塞尔曲线的时间分量同缩），
// loop 5.3333s → 5.3333×此值；发光呼吸同因子在 scale-anim-time.cjs 里缩放
const TIME_SCALE = 1.4
// 背手站姿的马尾增益：马尾在 背手 基础角（10°）上摆动，垂尾贴近身体视觉
// 中心，同角度读感明显放大——单独收小（约为普通站姿马尾增益的 40%）
const POSE_PONYTAIL_GAIN = 0.36
// 玛拉妮 loop（5.3333s）→ 普罗米娅骨骼。手11/手12/手3 无对应骨骼（前臂即末端）。
const BONE_MAP = {
  '身体': 'body',        // rotate + translate
  '身体3': 'head',       // 颈部小幅晃动 → 头骨
  '刘海': 'ponytail',    // 慢速摇晃模式 → 马尾（×增益）
  '上臂1': 'uparm_l_round',
  '小臂1': 'forearm_l_round',
  '上臂2': 'uparm_r_round',
  '小臂2': 'forearm_r_round'
}

const mualani = JSON.parse(fs.readFileSync(MUALANI, 'utf8'))
const promeia = JSON.parse(fs.readFileSync(PROMEIYA, 'utf8'))
const mLoop = mualani.animations['loop'].bones

// 旋转时间线数值/曲线值空间线性变换：v' = v * gain + offset（curve 的值分量同步变换）。
// 注意：Spine JSON 里 rotate 关键帧缺 "value" 字段时默认为 0（不是保持前值）——
// 原版 刘海 动画就是 0↔峰值 摆动、谷值帧不写 value；偏移变换必须把隐式 0
// 也纳入，否则马尾会从背手基础角一路摆回 0°（解背手位置）
function remapRotate(keys, gain, offset) {
  return keys.map((k) => {
    const out = { ...k }
    out.value = (k.value ?? 0) * gain + offset
    if (out.curve) {
      out.curve = out.curve.map((c, i) => (i % 2 === 1 ? c * gain + offset : c))
    }
    return out
  })
}

// 时间轴整体缩放：关键帧 time ×factor，贝塞尔曲线的 x（时间）分量 [0]/[2] 同缩
function scaleTime(keys) {
  return keys.map((k) => {
    const out = { ...k }
    if (out.time !== undefined) out.time = out.time * TIME_SCALE
    if (out.curve && Array.isArray(out.curve)) {
      out.curve = out.curve.map((c, i) => (i % 4 === 0 || i % 4 === 2 ? c * TIME_SCALE : c))
    }
    return out
  })
}

// —— 解背手待机：直接移植玛拉妮 loop 的对应时间线 ——
// 注意：不移植 身体.translate——那是整体上下浮动（y 0↔-1.75）与 x 偏移，
// 普罗米娅已用正弦浮动替换为由 loop 承担摆动，腿骨重挂 root 后 body 平移
// 会让躯干在固定的腿上剪切位移，故摆动只取 rotate（躯干绕髋部）
const loopBones = {}
for (const [mName, pName] of Object.entries(BONE_MAP)) {
  const tls = mLoop[mName]
  if (!tls) continue
  const mapped = {}
  if (tls.rotate) {
    const gain = (pName === 'ponytail' ? PONYTAIL_GAIN : 1) * SWAY_GAIN
    mapped.rotate = scaleTime(remapRotate(tls.rotate, gain, 0))
  }
  loopBones[pName] = mapped
}
const loop = { bones: loopBones }

// —— 背手待机：身体/头同 loop；马尾在 背手 基础角 10° 上摆动；手臂固定 ——
const backhandBase = {
  uparm_l_round: 30,
  uparm_r_round: -30,
  ponytail: 10
}
const LOOP_DURATION = 5.3333 * TIME_SCALE
const backhandBones = {
  body: loopBones.body,
  head: loopBones.head,
  ponytail: { rotate: scaleTime(remapRotate(mLoop['刘海'].rotate, POSE_PONYTAIL_GAIN, backhandBase.ponytail)) },
  uparm_l_round: { rotate: [{ time: 0, value: backhandBase.uparm_l_round }, { time: LOOP_DURATION, value: backhandBase.uparm_l_round }] },
  uparm_r_round: { rotate: [{ time: 0, value: backhandBase.uparm_r_round }, { time: LOOP_DURATION, value: backhandBase.uparm_r_round }] }
}

// 大衣：背手 末帧（alpha 1 + 594 顶点变形）整段持有
const beishou = promeia.animations['背手']
const coatRgbaLast = beishou.slots.coat.rgba[beishou.slots.coat.rgba.length - 1]
const coatDeformKeys = beishou.attachments.default.coat.coat.deform
const coatDeformLast = coatDeformKeys[coatDeformKeys.length - 1]
if (!coatDeformLast || !Array.isArray(coatDeformLast.vertices)) {
  throw new Error('背手 大衣变形末帧缺失')
}
const loopBackhand = {
  bones: backhandBones,
  slots: {
    coat: {
      rgba: [
        { time: 0, color: coatRgbaLast.color },
        { time: LOOP_DURATION, color: coatRgbaLast.color }
      ]
    }
  },
  attachments: {
    default: {
      coat: {
        coat: {
          deform: [
            { time: 0, vertices: coatDeformLast.vertices },
            { time: LOOP_DURATION, vertices: coatDeformLast.vertices }
          ]
        }
      }
    }
  }
}

const out = { loop, 'loop背手': loopBackhand }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))

const summarize = (anim) => Object.entries(anim.bones).map(([b, tls]) =>
  `${b}:${Object.keys(tls).join('+')}`).join(', ')
console.log('written:', OUT)
console.log('loop        :', summarize(loop))
console.log('loop背手    :', summarize(loopBackhand),
  '| coat rgba', coatRgbaLast.color, '+ deform', coatDeformLast.vertices.length, 'verts')
