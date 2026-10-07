export type PetPackType = 'gif' | 'live2d' | 'spine'

export type BehaviorMode = 'rules' | 'llm'

export interface PersonaConfig {
  name: string
  description?: string
  personality?: string
  systemPrompt?: string
  traits?: string[]
  [key: string]: unknown
}

export interface PetPackManifest {
  id: string
  name: string
  version: string
  type: PetPackType
  animations: string[]
  defaultScale?: number
  floating?: boolean
  author?: string
  persona?: PersonaConfig
  assetPaths?: Record<string, string>
  /**
   * per-pack 动作映射（ROADMAP M2）：action → 骨架动画名。
   * 键与渲染端 ACTION_ANIMATIONS 一致（idle/idleBase/sleep/wake/cheer/alarm/click/drag/dragEnd），
   * 未指定的键回退渲染端默认值；指定的动画名在骨架中必须存在才生效。
   */
  actions?: Record<string, string>
  /**
   * 相机取景需排除的槽位名（可选）。运行时 getBounds 不检查槽位 alpha，
   * 常驻隐藏的道具槽位（如开拓者的垃圾桶三层）会把包围盒撑大、相机缩远。
   * 只对列出的槽位生效，未声明的包行为不变。
   */
  cameraExcludeSlots?: string[]
  /**
   * 取景范围扩展（世界单位，可选）。用于动画中越出 setup 包围盒的内容
   * （如开拓者张望时高举的垃圾桶盖），否则会被舞台边缘截断。
   */
  cameraExtend?: { top?: number; right?: number; bottom?: number; left?: number }
  /** true = 不出现在包列表/切换菜单中（保留目录与历史配置） */
  hidden?: boolean
}

export interface CorpusConfig {
  enabled: boolean
  idleAfterMinutes: number
  sleepAfterMinutes: number
  idleCooldownMinutes: number
  phrases: Record<string, string[]>
}

export interface PetPack {
  manifest: PetPackManifest
  rootDir: string
  assets: Record<string, string>
  persona: PersonaConfig
  corpus: CorpusConfig
}

export interface ApiConfig {
  baseUrl: string
  apiKey: string
  model: string
  proxy: ProxyConfig
}

export interface ProxyConfig {
  enabled: boolean
  url: string
}

export interface ObsidianConfig {
  vaultPath: string
  baseFiles: string[]
}

export interface PetWindowState {
  packId: string
  action: string
  actionNonce: number
  animationName?: string
  emotion: string
  bubble: string
  bubbleVisible: boolean
  busy: boolean
  packType: PetPackType
}

export interface AppConfig {
  api: ApiConfig
  obsidian: ObsidianConfig
  currentPackId: string
  petPosition: { x: number; y: number }
  petScales: Record<string, number>
  coatStates: Record<string, boolean>
  spine: {
    blinkIntervalSeconds: number
    sleepAnimationIntervalSeconds: number
  }
  reminders: {
    enabled: boolean
    minIntervalMinutes: number
    startHour: number
    endHour: number
  }
  autostart: boolean
  behaviorMode: BehaviorMode
  bubbleDurationSeconds: number
  todo: {
    filterPrompt: string
    homeworkBaseFiles: string[]
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface TodoItem {
  filePath: string
  title: string
  content: string
  completed: boolean
  priority: string
  dueDate: string
  tags: string[]
  complexity: string
  remainingDays?: number | null
  baseFile?: string
  baseName?: string
}

export interface PetEvent {
  type: 'click' | 'drag-start' | 'drag-end' | 'idle' | 'sleep' | 'wake' | 'chat-open' | 'chat-close' | 'cheer' | 'alarm'
  payload?: Record<string, unknown>
}

export interface SkillResult {
  success: boolean
  data?: unknown
  error?: string
  bubble?: string
  action?: string
  emotion?: string
}

export interface SkillContext {
  config: AppConfig
  llm: unknown
  obsidian: unknown
  sendPetState?: (state: Partial<PetWindowState>) => void
}

export interface Skill {
  name: string
  description: string
  execute(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult>
}
