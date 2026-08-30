import { app, BrowserWindow } from 'electron'
import { registerPetAssetProtocol, registerPetAssetHandler } from './protocol'
import { createPetWindow, createPanelWindow, getPetWindow, sendToPet } from './windows'
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

    createPetWindow(config.get().petPosition)
    createPanelWindow()
    createTray(() => app.quit())

    const currentPack = packs.get(config.get().currentPackId) ?? packs.list()[0]
    if (currentPack) behavior.start(currentPack)
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，不随窗口关闭退出
  })
}
