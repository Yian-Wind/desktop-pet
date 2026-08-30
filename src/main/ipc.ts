import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { AppConfig, ChatMessage, PetEvent } from '../shared/types'
import { ConfigStore } from './config'
import { PetPackManager } from './services/pet-pack-manager'
import { LLMClient } from './services/llm-client'
import { ObsidianBaseService } from './services/obsidian-base'
import { SkillBus } from './skill-bus'
import { createChatSkill } from './skills/chat'
import { createTodoSkill } from './skills/obsidian-todos'
import { BehaviorEngine } from './behavior-engine'
import { getPetWindow, openPanel, sendToPet } from './windows'

export function registerIpcHandlers(
  config: ConfigStore,
  packs: PetPackManager,
  llm: LLMClient,
  obsidian: ObsidianBaseService,
  skills: SkillBus,
  behavior: BehaviorEngine
): void {
  const chatHistory: ChatMessage[] = []

  ipcMain.handle(IPC.CONFIG_GET, () => config.get())

  ipcMain.handle(IPC.CONFIG_SAVE, (_event, cfg: AppConfig) => {
    config.save(cfg)
    app.setLoginItemSettings({ openAtLogin: cfg.autostart })
    return config.get()
  })

  ipcMain.handle(IPC.PACK_LIST, () => packs.list())

  ipcMain.handle(IPC.PACK_SWITCH, (_event, packId: string) => {
    const pack = packs.get(packId)
    if (!pack) return null
    const cfg = config.get()
    config.save({ ...cfg, currentPackId: packId })
    behavior.start(pack)
    return pack
  })

  ipcMain.handle(IPC.PET_GET_STATE, () => behavior.getState())

  ipcMain.handle(IPC.PET_EVENT, (_event, petEvent: PetEvent) => {
    return behavior.handle(petEvent)
  })

  ipcMain.handle(IPC.PET_MOVE, (_event, x: number, y: number) => {
    const win = getPetWindow()
    if (!win || win.isDestroyed()) return
    win.setPosition(Math.round(x), Math.round(y))
    const cfg = config.get()
    config.save({ ...cfg, petPosition: { ...cfg.petPosition, x, y } })
  })

  ipcMain.handle(IPC.CHAT_GET_HISTORY, () => chatHistory)

  ipcMain.handle(IPC.CHAT_SEND, async (_event, text: string) => {
    const cfg = config.get()
    const pack = packs.get(cfg.currentPackId)
    const persona = pack?.manifest.persona
    const userMessage: ChatMessage = { role: 'user', content: text, timestamp: Date.now() }
    const messages: ChatMessage[] = [...chatHistory.slice(-20), userMessage]
    if (persona?.systemPrompt) {
      messages.unshift({ role: 'assistant', content: persona.systemPrompt, timestamp: Date.now() })
    }
    const result = await skills.execute('chat', { messages }, {
      config: cfg,
      llm,
      obsidian,
      sendPetState: (state) => sendToPet('pet:state', state)
    })
    if (result.success && typeof result.data === 'string') {
      const reply: ChatMessage = { role: 'assistant', content: result.data, timestamp: Date.now() }
      chatHistory.push(userMessage, reply)
      behavior.setBubble(result.bubble ?? '')
      return reply
    }
    chatHistory.push(userMessage)
    return { error: result.error ?? '对话失败' }
  })

  ipcMain.handle(IPC.OBSIDIAN_GET_TODOS, async () => {
    const cfg = config.get()
    if (!cfg.obsidian.baseFile) return []
    return obsidian.getTodos(cfg.obsidian.vaultPath, cfg.obsidian.baseFile)
  })

  ipcMain.handle(IPC.OBSIDIAN_ADD_TODO, async (_event, title: string, content: string) => {
    const cfg = config.get()
    if (!cfg.obsidian.baseFile) throw new Error('请先选择 .base 文件')
    return obsidian.addTodo(cfg.obsidian.vaultPath, cfg.obsidian.baseFile, title, content)
  })

  ipcMain.handle(IPC.OBSIDIAN_COMPLETE_TODO, async (_event, filePath: string, completed: boolean) => {
    await obsidian.completeTodo(filePath, completed)
    return true
  })

  ipcMain.handle(IPC.WINDOW_OPEN_PANEL, () => openPanel())

  ipcMain.handle(IPC.WINDOW_CLOSE_PANEL, () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  ipcMain.handle(IPC.WINDOW_QUIT, () => {
    app.quit()
  })
}
