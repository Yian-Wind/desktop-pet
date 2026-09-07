// 姿势切换动画对（含两者成对的包 = 姿势切换包，点击在两姿势间翻转）
export const POSE_ANIMATIONS = new Set(['背手', '解背手'])

export const CLICK_EXCLUDED_ANIMATIONS = new Set([
  'eye', 'loop', 'loop笑', 'walk', '举手张嘴', '闹钟提示',
  ...POSE_ANIMATIONS
])

export const SLEEP_EXCLUDED_ANIMATIONS = new Set([...CLICK_EXCLUDED_ANIMATIONS, '冲浪'])
