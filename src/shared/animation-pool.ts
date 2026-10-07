// 姿势切换动画对（含两者成对的包 = 姿势切换包，点击在两姿势间翻转）
export const POSE_ANIMATIONS = new Set(['背手', '解背手'])

// 刃舞：待机表演动画（behavior-engine 定时触发），不参与随机池
export const IDLE_SHOW_ANIMATIONS = new Set(['刃舞'])

// 垃圾桶状态机动画（开拓者）：入桶/顶盖张望为一次性过渡（渲染端播完队列
// 桶内待机循环），桶内待机为睡眠循环，跳出炸开为唤醒一次性（播完归位待机）
export const BIN_INTRO_ANIMATION = '入桶'
export const BIN_LOOP_ANIMATION = '桶内待机'
export const BIN_PEEK_ANIMATION = '顶盖张望'
export const BIN_PEEK_DURATION_SECONDS = 3.4  // 张望动画总长（add_bin_animations.py）
// 张望"露出"时长：约 3.0s 时开拓者已缩回桶内（2.88s 归位、2.98s 合盖），
// 之后的 0.4s 只是尾部过渡——激活窗口按此计，避免"看起来结束了再点却跳出"
export const BIN_PEEK_ACTIVE_SECONDS = 3.0
export const BIN_ESCAPE_ANIMATION = '跳出炸开'
export const BIN_ANIMATIONS = new Set([
  BIN_INTRO_ANIMATION, BIN_LOOP_ANIMATION, BIN_PEEK_ANIMATION, BIN_ESCAPE_ANIMATION
])

// 开拓者（trailblazer）：idel 是待机基底（已融入眨眼），idel_emoji1 是快捷按钮
// 复合表情（cheer/alarm 动作映射），emoji_* 是表情贴图切换（0.1s 瞬时或短促变形），
// 桶状态机四支不进随机池
const TRAILBLAZER_INTERNAL_ANIMATIONS = [
  'idel', 'idel_emoji1', 'emoji_0', 'emoji_1', 'emoji_2', 'emoji_3', 'emoji_4', 'emoji_5',
  ...BIN_ANIMATIONS
]

export const CLICK_EXCLUDED_ANIMATIONS = new Set([
  'eye', 'loop', 'loop背手', 'loop笑', 'walk', '举手张嘴', '闹钟提示',
  ...POSE_ANIMATIONS,
  ...IDLE_SHOW_ANIMATIONS,
  ...TRAILBLAZER_INTERNAL_ANIMATIONS
])

export const SLEEP_EXCLUDED_ANIMATIONS = new Set([...CLICK_EXCLUDED_ANIMATIONS, '冲浪'])
