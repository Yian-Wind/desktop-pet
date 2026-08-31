import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AppConfig,
  ChatMessage,
  CorpusConfig,
  PersonaConfig,
  PetEvent,
  PetPack,
  PetWindowState,
  TodoItem
} from '../shared/types'
import type { PetApi } from '../shared/pet-api'

const api: PetApi = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_GET),
  saveConfig: (config: AppConfig): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_SAVE, config),
  listPacks: (): Promise<PetPack[]> => ipcRenderer.invoke(IPC.PACK_LIST),
  switchPack: (packId: string): Promise<PetPack | null> => ipcRenderer.invoke(IPC.PACK_SWITCH, packId),
  savePersona: (packId: string, persona: PersonaConfig): Promise<PetPack | null> =>
    ipcRenderer.invoke(IPC.PACK_SAVE_PERSONA, packId, persona),
  saveCorpus: (packId: string, corpus: CorpusConfig): Promise<PetPack | null> =>
    ipcRenderer.invoke(IPC.PACK_SAVE_CORPUS, packId, corpus),
  openPackDir: (packId: string): Promise<string> => ipcRenderer.invoke(IPC.PACK_OPEN_DIR, packId),
  getPetState: (): Promise<PetWindowState> => ipcRenderer.invoke(IPC.PET_GET_STATE),
  sendPetEvent: (event: PetEvent): Promise<void> => ipcRenderer.invoke(IPC.PET_EVENT, event),
  movePet: (x: number, y: number): Promise<void> => ipcRenderer.invoke(IPC.PET_MOVE, x, y),
  setPetSize: (scale: number): Promise<void> => ipcRenderer.invoke(IPC.PET_SET_SIZE, scale),
  setPetClickThrough: (ignore: boolean): Promise<void> => ipcRenderer.invoke(IPC.PET_SET_CLICK_THROUGH, ignore),
  showContextMenu: (): Promise<void> => ipcRenderer.invoke(IPC.PET_CONTEXT_MENU),
  onPetState: (callback: (state: PetWindowState) => void): (() => void) => {
    const listener = (_event: unknown, state: PetWindowState) => callback(state)
    ipcRenderer.on('pet:state', listener)
    return () => ipcRenderer.removeListener('pet:state', listener)
  },
  onPackChanged: (callback: (pack: PetPack) => void): (() => void) => {
    const listener = (_event: unknown, pack: PetPack) => callback(pack)
    ipcRenderer.on('pack:changed', listener)
    return () => ipcRenderer.removeListener('pack:changed', listener)
  },
  onConfigChanged: (callback: (config: AppConfig) => void): (() => void) => {
    const listener = (_event: unknown, config: AppConfig) => callback(config)
    ipcRenderer.on(IPC.CONFIG_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.CONFIG_CHANGED, listener)
  },
  sendChat: (text: string): Promise<ChatMessage | { error: string }> => ipcRenderer.invoke(IPC.CHAT_SEND, text),
  testChat: (): Promise<{ ok: boolean; reply?: string; error?: string }> => ipcRenderer.invoke(IPC.CHAT_TEST),
  getChatHistory: (): Promise<ChatMessage[]> => ipcRenderer.invoke(IPC.CHAT_GET_HISTORY),
  getTodos: (): Promise<TodoItem[]> => ipcRenderer.invoke(IPC.OBSIDIAN_GET_TODOS),
  addTodo: (title: string, content: string): Promise<TodoItem> => ipcRenderer.invoke(IPC.OBSIDIAN_ADD_TODO, title, content),
  completeTodo: (filePath: string, completed: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.OBSIDIAN_COMPLETE_TODO, filePath, completed),
  openPanel: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_OPEN_PANEL),
  closePanel: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_CLOSE_PANEL),
  quit: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_QUIT)
}

contextBridge.exposeInMainWorld('petApi', api)
