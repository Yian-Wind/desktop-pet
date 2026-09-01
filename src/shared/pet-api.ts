import type {
  AppConfig,
  ChatMessage,
  CorpusConfig,
  PersonaConfig,
  PetEvent,
  PetPack,
  PetWindowState,
  TodoItem
} from './types'

export interface PetApi {
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  listPacks: () => Promise<PetPack[]>
  switchPack: (packId: string) => Promise<PetPack | null>
  savePersona: (packId: string, persona: PersonaConfig) => Promise<PetPack | null>
  saveCorpus: (packId: string, corpus: CorpusConfig) => Promise<PetPack | null>
  openPackDir: (packId: string) => Promise<string>
  getPetState: () => Promise<PetWindowState>
  sendPetEvent: (event: PetEvent) => Promise<void>
  movePet: (x: number, y: number) => void
  dropPet: () => Promise<void>
  setPetSize: (scale: number, packId?: string) => Promise<void>
  setPetClickThrough: (ignore: boolean) => Promise<void>
  showContextMenu: () => Promise<void>
  scheduleAlarm: (minutes: number) => Promise<void>
  onPetState: (callback: (state: PetWindowState) => void) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  onPackChanged: (callback: (pack: PetPack) => void) => () => void
  sendChat: (text: string) => Promise<ChatMessage | { error: string }>
  testChat: () => Promise<{ ok: boolean; reply?: string; error?: string }>
  getChatHistory: () => Promise<ChatMessage[]>
  recommendTodo: () => Promise<{ text: string; error?: string }>
  getTodos: () => Promise<TodoItem[]>
  addTodo: (title: string, content: string) => Promise<TodoItem>
  completeTodo: (filePath: string, completed: boolean) => Promise<boolean>
  openPanel: () => Promise<void>
  closePanel: () => Promise<void>
  quit: () => Promise<void>
}
