import { app } from 'electron'
import { registerPetAssetProtocol, registerPetAssetHandler } from './protocol'
import { createPetWindow, getPetWindow, sendToPet } from './windows'
import { createTray } from './tray'
import { ConfigStore } from './config'
import { PetPackManager } from './services/pet-pack-manager'
import { LLMClient } from './services/llm-client'
import { ObsidianBaseService } from './services/obsidian-base'
import { SkillBus } from './skill-bus'
import { createChatSkill } from './skills/chat'
import { createTodoSkill } from './skills/obsidian-todos'
import { BehaviorEngine } from './behavior-engine'
import { registerIpcHandlers } from './ipc'

registerPetAssetProtocol()
app.setAppUserModelId('com.desktop-pet.desktop-pet')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (getPetWindow()) getPetWindow()?.focus()
  })

  app.whenReady().then(() => {
    registerPetAssetHandler()

    const config = new ConfigStore()
    const packs = new PetPackManager()
    const llm = new LLMClient()
    const obsidian = new ObsidianBaseService()
    const skills = new SkillBus()
    skills.register(createChatSkill())
    skills.register(createTodoSkill())

    const behavior = new BehaviorEngine((state) => sendToPet('pet:state', state))
    registerIpcHandlers(config, packs, llm, obsidian, skills, behavior)

    const startupConfig = config.get()
    behavior.setSleepAnimationIntervalSeconds(startupConfig.spine.sleepAnimationIntervalSeconds)
    behavior.setBubbleDurationSeconds(startupConfig.bubbleDurationSeconds)
    const startupPack = packs.get(startupConfig.currentPackId) ?? packs.list()[0]
    createPetWindow({
      ...startupConfig.petPosition,
      scale: startupConfig.petScales[startupPack?.manifest.id ?? ''] ?? startupPack?.manifest.defaultScale ?? 1
    })
    // 面板窗口懒建：openPanel 首次调用时才创建，省一个常驻渲染进程（~160MB）
    createTray(() => app.quit())

    const currentPack = startupPack
    if (currentPack) behavior.start(currentPack)
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，不随窗口关闭退出
  })

  // 退出看门狗：pet-asset 流式协议或有挂起的渲染进程会让 app.quit() 的正常
  // 流程无限等待（主进程存活 → 单实例锁被占 → 后续启动全部静默退出、
  // 旧资产永久驻留）。1.5s 后强制终结本进程与全部子进程（GPU/网络服务）。
  app.on('before-quit', () => {
    setTimeout(() => app.exit(0), 1500)
  })
}
