import type { AppConfig, ChatMessage, PetEvent, PetPack, PetWindowState, TodoItem } from './types'

export interface PetApi {
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  listPacks: () => Promise<PetPack[]>
  switchPack: (packId: string) => Promise<PetPack | null>
  getPetState: () => Promise<PetWindowState>
  sendPetEvent: (event: PetEvent) => Promise<void>
  movePet: (x: number, y: number) => void
  setPetSize: (scale: number) => void
  onPetState: (callback: (state: PetWindowState) => void) => () => void
  sendChat: (text: string) => Promise<ChatMessage | { error: string }>
  testChat: () => Promise<{ ok: boolean; reply?: string; error?: string }>
  getChatHistory: () => Promise<ChatMessage[]>
  getTodos: () => Promise<TodoItem[]>
  addTodo: (title: string, content: string) => Promise<TodoItem>
  completeTodo: (filePath: string, completed: boolean) => Promise<boolean>
  openPanel: () => void
  closePanel: () => void
  quit: () => void
}
