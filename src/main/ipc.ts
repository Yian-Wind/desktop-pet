import { app, ipcMain, BrowserWindow, Menu, screen, shell } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { AppConfig, ChatMessage, CorpusConfig, PersonaConfig, PetEvent, PetPack } from '../shared/types'
import { ConfigStore } from './config'
import { PetPackManager } from './services/pet-pack-manager'
import { LLMClient } from './services/llm-client'
import { ObsidianBaseService } from './services/obsidian-base'
import { SkillBus } from './skill-bus'
import { BehaviorEngine } from './behavior-engine'
import { getPetWindow, openPanel, sendToPanel, sendToPet, setPetScale } from './windows'

export function registerIpcHandlers(
  config: ConfigStore,
  packs: PetPackManager,
  llm: LLMClient,
  obsidian: ObsidianBaseService,
  skills: SkillBus,
  behavior: BehaviorEngine
): void {
  const chatHistoryByPack = new Map<string, ChatMessage[]>()
  let petDropTimer: ReturnType<typeof setInterval> | null = null

  function getChatHistory(packId: string): ChatMessage[] {
    return chatHistoryByPack.get(packId) ?? []
  }

  function pushChat(packId: string, ...messages: ChatMessage[]): void {
    const history = getChatHistory(packId)
    history.push(...messages)
    chatHistoryByPack.set(packId, history)
  }

  function notifyPackChanged(pack: PetPack): void {
    sendToPanel('pack:changed', pack)
  }

  function stopPetDrop(): void {
    if (petDropTimer === null) return
    clearInterval(petDropTimer)
    petDropTimer = null
  }

  ipcMain.handle(IPC.CONFIG_GET, () => config.get())

  ipcMain.handle(IPC.CONFIG_SAVE, (_event, cfg: AppConfig) => {
    config.save(cfg)
    app.setLoginItemSettings({ openAtLogin: cfg.autostart })
    setPetScale(cfg.petPosition.scale)
    const saved = config.get()
    sendToPet(IPC.CONFIG_CHANGED, saved)
    return saved
  })

  ipcMain.handle(IPC.PET_SET_CLICK_THROUGH, (_event, ignore: boolean) => {
    getPetWindow()?.setIgnoreMouseEvents(ignore, { forward: true })
    return true
  })

  ipcMain.handle(IPC.PACK_LIST, () => packs.list())

  ipcMain.handle(IPC.PACK_SWITCH, (_event, packId: string) => {
    const pack = packs.get(packId)
    if (!pack) return null
    const cfg = config.get()
    config.save({ ...cfg, currentPackId: packId })
    behavior.start(pack)
    notifyPackChanged(pack)
    return pack
  })

  ipcMain.handle(IPC.PACK_SAVE_PERSONA, (_event, packId: string, persona: PersonaConfig) => {
    const pack = packs.savePersona(packId, persona)
    if (!pack) return null
    notifyPackChanged(pack)
    return pack
  })

  ipcMain.handle(IPC.PACK_SAVE_CORPUS, (_event, packId: string, corpus: CorpusConfig) => {
    const pack = packs.saveCorpus(packId, corpus)
    if (!pack) return null
    if (config.get().currentPackId === packId) behavior.start(pack)
    notifyPackChanged(pack)
    return pack
  })

  ipcMain.handle(IPC.PACK_OPEN_DIR, async (_event, packId: string) => {
    const pack = packs.get(packId)
    if (!pack) return '未找到角色包'
    return shell.openPath(pack.rootDir)
  })

  ipcMain.handle(IPC.PET_GET_STATE, () => behavior.getState())

  ipcMain.handle(IPC.PET_EVENT, (_event, petEvent: PetEvent) => {
    return behavior.handle(petEvent)
  })

  ipcMain.handle(IPC.PET_MOVE, (_event, x: number, y: number) => {
    stopPetDrop()
    const win = getPetWindow()
    if (!win || win.isDestroyed()) return
    win.setPosition(Math.round(x), Math.round(y))
  })

  ipcMain.handle(IPC.PET_DROP, () => {
    stopPetDrop()
    const win = getPetWindow()
    if (!win || win.isDestroyed()) return

    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const maxY = display.workArea.y + display.workArea.height - bounds.height
    const distance = Math.min(80, Math.max(0, maxY - bounds.y))
    if (distance === 0) {
      const cfg = config.get()
      config.save({ ...cfg, petPosition: { ...cfg.petPosition, x: bounds.x, y: bounds.y } })
      return
    }

    const startX = bounds.x
    const startY = bounds.y
    const duration = 280
    const startedAt = Date.now()
    petDropTimer = setInterval(() => {
      const currentWindow = getPetWindow()
      if (!currentWindow || currentWindow.isDestroyed()) {
        stopPetDrop()
        return
      }

      const progress = Math.min(1, (Date.now() - startedAt) / duration)
      currentWindow.setPosition(startX, Math.round(startY + distance * progress * progress))
      if (progress < 1) return

      stopPetDrop()
      const cfg = config.get()
      config.save({ ...cfg, petPosition: { ...cfg.petPosition, x: startX, y: startY + distance } })
    }, 16)
  })

  ipcMain.handle(IPC.PET_SET_SIZE, (_event, scale: number) => {
    const win = getPetWindow()
    if (!win || win.isDestroyed()) return
    setPetScale(scale)
    const cfg = config.get()
    config.save({ ...cfg, petPosition: { ...cfg.petPosition, scale } })
  })

  ipcMain.handle(IPC.PET_CONTEXT_MENU, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const cfg = config.get()
    const packList = packs.list()
    const template = [
      { label: '打开面板', click: () => openPanel() },
      { label: '设置', click: () => openPanel() },
      { type: 'separator' as const },
      ...packList.map((pack) => ({
        label: pack.manifest.name,
        type: 'radio' as const,
        checked: pack.manifest.id === cfg.currentPackId,
        click: () => {
          const nextCfg = config.get()
          config.save({ ...nextCfg, currentPackId: pack.manifest.id })
          behavior.start(pack)
          notifyPackChanged(pack)
        }
      })),
      { type: 'separator' as const },
      { label: '退出', click: () => app.quit() }
    ]
    Menu.buildFromTemplate(template).popup({ window: win })
  })

  ipcMain.handle(IPC.CHAT_GET_HISTORY, () => getChatHistory(config.get().currentPackId))

  ipcMain.handle(IPC.CHAT_SEND, async (_event, text: string) => {
    const cfg = config.get()
    const pack = packs.get(cfg.currentPackId)
    const systemPrompt = pack ? buildPersonaPrompt(pack.persona) : ''
    const userMessage: ChatMessage = { role: 'user', content: text, timestamp: Date.now() }
    const history = getChatHistory(cfg.currentPackId)
    const messages: ChatMessage[] = [...history.slice(-20), userMessage]
    if (systemPrompt) {
      messages.unshift({ role: 'system', content: systemPrompt, timestamp: Date.now() })
    }
    const result = await skills.execute('chat', { messages }, {
      config: cfg,
      llm,
      obsidian,
      sendPetState: (state) => sendToPet('pet:state', state)
    })
    if (result.success && typeof result.data === 'string') {
      const reply: ChatMessage = { role: 'assistant', content: result.data, timestamp: Date.now() }
      pushChat(cfg.currentPackId, userMessage, reply)
      behavior.setBubble(result.bubble ?? '')
      return reply
    }
    pushChat(cfg.currentPackId, userMessage)
    return { error: result.error ?? '对话失败' }
  })

  ipcMain.handle(IPC.CHAT_TEST, async () => {
    const cfg = config.get()
    const pack = packs.get(cfg.currentPackId)
    const system = pack ? buildPersonaPrompt(pack.persona) : ''
    const fallback = pack ? `你叫${pack.manifest.name}，是一个桌面宠物助手。` : '你是一个桌面宠物助手。'
    const messages: ChatMessage[] = [
      { role: 'system', content: system || fallback, timestamp: Date.now() },
      { role: 'user', content: '请用你的角色身份做一次自我介绍，并说明你此刻的状态。', timestamp: Date.now() }
    ]
    const result = await skills.execute('chat', { messages }, {
      config: cfg,
      llm,
      obsidian,
      sendPetState: (state) => sendToPet('pet:state', state)
    })
    if (result.success && typeof result.data === 'string') {
      behavior.setBubble(result.data.slice(0, 80))
      return { ok: true, reply: result.data }
    }
    return { ok: false, error: result.error ?? '扮演测试失败' }
  })

  ipcMain.handle(IPC.OBSIDIAN_GET_TODOS, async () => {
    const cfg = config.get()
    if (cfg.obsidian.baseFiles.length === 0) return []
    return obsidian.getTodos(cfg.obsidian.vaultPath, cfg.obsidian.baseFiles)
  })

  ipcMain.handle(IPC.OBSIDIAN_ADD_TODO, async (_event, title: string, content: string) => {
    const cfg = config.get()
    if (cfg.obsidian.baseFiles.length === 0) throw new Error('请先添加 .base 文件')
    return obsidian.addTodo(cfg.obsidian.vaultPath, cfg.obsidian.baseFiles[0], title, content)
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

function buildPersonaPrompt(input: { name?: string; description?: string; personality?: string; systemPrompt?: string; traits?: string[] } | undefined): string {
  if (!input) return ''
  const parts: string[] = []
  if (input.name) parts.push(`你叫${input.name}`)
  if (input.description) parts.push(input.description)
  if (input.personality) parts.push(`性格：${input.personality}`)
  if (input.traits?.length) parts.push(`特质：${input.traits.filter(Boolean).join('、')}`)
  if (input.systemPrompt?.trim()) parts.push(input.systemPrompt.trim())
  return parts.join('。')
}
