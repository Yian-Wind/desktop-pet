import { app, ipcMain, BrowserWindow, Menu, Notification, shell } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { AppConfig, ChatMessage, CorpusConfig, PersonaConfig, PetEvent, PetPack } from '../shared/types'
import { ConfigStore } from './config'
import { PetPackManager } from './services/pet-pack-manager'
import { LLMClient } from './services/llm-client'
import { ObsidianBaseService } from './services/obsidian-base'
import { buildChatTodoContext, buildTodoRecommendationMessages, ensureTodoReplyPrefix, fallbackTodoRecommendation, parseTodoRecommendationReply } from './services/todo-intelligence'
import { SkillBus } from './skill-bus'
import { BehaviorEngine } from './behavior-engine'
import { getPetStagePosition, getPetWindow, getPetWindowMargin, openPanel, sendToPanel, sendToPet, setPetScale, setPetStagePosition } from './windows'

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
  let alarmTimer: ReturnType<typeof setTimeout> | null = null

  const dropDistance = 10
  const dropFallDuration = 140

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

  function getPetScale(packId: string): number {
    const cfg = config.get()
    const savedScale = cfg.petScales[packId]
    if (Number.isFinite(savedScale)) return savedScale
    return packs.get(packId)?.manifest.defaultScale ?? 1
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
    setPetScale(getPetScale(cfg.currentPackId))
    const saved = config.get()
    behavior.setSleepAnimationIntervalSeconds(saved.spine.sleepAnimationIntervalSeconds)
    behavior.setBubbleDurationSeconds(saved.bubbleDurationSeconds)
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
    setPetScale(getPetScale(packId))
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

  ipcMain.on(IPC.PET_MOVE, (_event, x: number, y: number) => {
    stopPetDrop()
    const win = getPetWindow()
    if (!win || win.isDestroyed()) return
    const margin = getPetWindowMargin(win.getBounds().width)
    setPetStagePosition(x + margin, y + margin)
  })

  ipcMain.handle(IPC.PET_DROP, () => {
    stopPetDrop()
    const win = getPetWindow()
    if (!win || win.isDestroyed()) return

    const startStage = getPetStagePosition()
    const startX = startStage.x
    const startY = startStage.y
    const duration = dropFallDuration
    const startedAt = Date.now()
    petDropTimer = setInterval(() => {
      const currentWindow = getPetWindow()
      if (!currentWindow || currentWindow.isDestroyed()) {
        stopPetDrop()
        return
      }

      const elapsed = Math.min(duration, Date.now() - startedAt)
      const progress = elapsed / duration
      setPetStagePosition(startX, startY + dropDistance * progress * progress)
      if (elapsed < duration) return

      stopPetDrop()
      const cfg = config.get()
      config.save({ ...cfg, petPosition: { ...cfg.petPosition, x: startX, y: startY + dropDistance } })
    }, 16)
  })

  ipcMain.handle(IPC.PET_SET_SIZE, (_event, scale: number, packId?: string) => {
    const win = getPetWindow()
    if (!win || win.isDestroyed()) return
    const cfg = config.get()
    const targetPackId = packId ?? cfg.currentPackId
    config.save({ ...cfg, petScales: { ...cfg.petScales, [targetPackId]: scale } })
    if (targetPackId === config.get().currentPackId) setPetScale(scale)
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
          setPetScale(getPetScale(pack.manifest.id))
          behavior.start(pack)
          notifyPackChanged(pack)
        }
      })),
      { type: 'separator' as const },
      { label: '退出', click: () => app.quit() }
    ]
    Menu.buildFromTemplate(template).popup({ window: win })
  })

  ipcMain.handle(IPC.PET_ALARM_SCHEDULE, (_event, minutes: number) => {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      throw new Error('闹钟时间必须在 1-1440 分钟之间')
    }

    if (alarmTimer) clearTimeout(alarmTimer)
    alarmTimer = setTimeout(() => {
      alarmTimer = null
      const text = `时间到：${minutes} 分钟定时闹钟`
      void behavior.handle({ type: 'alarm', payload: { text } })

      const notification = new Notification({
        title: '桌面宠物闹钟',
        body: text,
        silent: false
      })
      notification.on('click', () => openPanel())
      notification.show()
    }, minutes * 60_000)
    return true
  })

  ipcMain.handle(IPC.CHAT_GET_HISTORY, () => getChatHistory(config.get().currentPackId))

  ipcMain.handle(IPC.CHAT_SEND, async (_event, text: string) => {
    const cfg = config.get()
    const pack = packs.get(cfg.currentPackId)
    const personaPrompt = pack?.persona.systemPrompt?.trim() || (pack ? `你叫${pack.manifest.name}，是一个桌面宠物助手。` : '你是一个桌面宠物助手。')
    const userMessage: ChatMessage = { role: 'user', content: text, timestamp: Date.now() }
    const history = getChatHistory(cfg.currentPackId)
    const todos = cfg.obsidian.baseFiles.length > 0
      ? await obsidian.getTodos(cfg.obsidian.vaultPath, cfg.obsidian.baseFiles)
      : []
    const todoContext = buildChatTodoContext(text, history, todos, cfg)
    const systemContent = todoContext ? `${personaPrompt}\n\n${todoContext}` : personaPrompt
    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent, timestamp: Date.now() },
      ...history.slice(-6),
      userMessage
    ]
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
    const system = pack?.persona.systemPrompt?.trim() || ''
    const fallback = pack ? `你叫${pack.manifest.name}，是一个桌面宠物助手。` : '你是一个桌面宠物助手。'
    const messages: ChatMessage[] = [
      { role: 'system', content: system || fallback, timestamp: Date.now() },
      { role: 'user', content: '请用你的角色身份做一次自我介绍，并说明你此刻的状态。', timestamp: Date.now() }
    ]
    const result = await skills.execute('chat', { messages, maxTokens: 300 }, {
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

  ipcMain.handle(IPC.TODO_RECOMMEND, async () => {
    const cfg = config.get()
    if (cfg.obsidian.baseFiles.length === 0) {
      return { text: '请先配置待办 Base' }
    }
    const todos = await obsidian.getTodos(cfg.obsidian.vaultPath, cfg.obsidian.baseFiles)
    const pack = packs.get(cfg.currentPackId)
    const fallbackText = fallbackTodoRecommendation(todos, cfg, pack?.persona)
    if (!cfg.api.baseUrl || !cfg.api.apiKey || !cfg.api.model) {
      return { text: fallbackText, error: 'API 未配置，使用本地筛选' }
    }

    try {
      const messages = buildTodoRecommendationMessages(todos, pack?.persona, cfg)
      const reply = await llm.chat(messages, cfg.api, 1200)
      const parsed = parseTodoRecommendationReply(reply)
      const shortReply = parsed?.reply || reply.slice(0, 80)
      return { text: shortReply ? ensureTodoReplyPrefix(shortReply, pack?.persona) : fallbackText }
    } catch (error) {
      return { text: fallbackText, error: error instanceof Error ? error.message : String(error) }
    }
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
