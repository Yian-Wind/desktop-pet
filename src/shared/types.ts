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
  author?: string
  persona?: PersonaConfig
  assetPaths?: Record<string, string>
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
  baseName?: string
}

export interface PetEvent {
  type: 'click' | 'drag-start' | 'drag-end' | 'idle' | 'sleep' | 'wake' | 'chat-open' | 'chat-close'
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
