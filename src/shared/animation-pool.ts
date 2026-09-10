// 姿势切换动画对（含两者成对的包 = 姿势切换包，点击在两姿势间翻转）
export const POSE_ANIMATIONS = new Set(['背手', '解背手'])

// 刃舞：待机表演动画（behavior-engine 定时触发），不参与随机池
export const IDLE_SHOW_ANIMATIONS = new Set(['刃舞'])

export const CLICK_EXCLUDED_ANIMATIONS = new Set([
  'eye', 'loop', 'loop笑', 'walk', '举手张嘴', '闹钟提示',
  ...POSE_ANIMATIONS,
  ...IDLE_SHOW_ANIMATIONS
])

export const SLEEP_EXCLUDED_ANIMATIONS = new Set([...CLICK_EXCLUDED_ANIMATIONS, '冲浪'])
