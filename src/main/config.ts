import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { AppConfig, ApiConfig, TriggerConfig } from '../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  api: { baseUrl: '', apiKey: '', model: '' },
  obsidian: { vaultPath: '', baseFiles: [] },
  persona: {
    enabled: false,
    name: '',
    systemPrompt: ''
  },
  currentPackId: 'fairy',
  petPosition: { x: 100, y: 100, scale: 1.0 },
  triggers: {
    enabled: true,
    idleAfterMinutes: 3,
    sleepAfterMinutes: 10,
    idleCooldownMinutes: 5,
    phrases: {
      click: ['戳到我啦~', '嘿嘿，好痒~', '有事找我吗？'],
      'drag-end': ['飞起来啦！', '哇啊——', '放我下来！'],
      idle: ['我在呢~', '今天过得怎么样？', '需要我帮你记点事吗？'],
      sleep: ['呼...呼...', '让我眯一会儿…', 'Zzz…'],
      wake: ['我醒啦！', '刚刚睡饱了~', '回来啦！']
    }
  },
  reminders: { enabled: true, minIntervalMinutes: 30, startHour: 9, endHour: 22 },
  autostart: false,
  behaviorMode: 'rules'
}

export class ConfigStore {
  private filePath: string
  private config: AppConfig

  constructor() {
    const userData = app.getPath('userData')
    if (!existsSync(userData)) mkdirSync(userData, { recursive: true })
    this.filePath = join(userData, 'pet-config.json')
    this.config = this.load()
  }

  private load(): AppConfig {
    if (!existsSync(this.filePath)) return { ...DEFAULT_CONFIG, api: { ...DEFAULT_CONFIG.api } }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      return this.merge(raw)
    } catch {
      return { ...DEFAULT_CONFIG, api: { ...DEFAULT_CONFIG.api } }
    }
  }

  private merge(raw: Partial<AppConfig> & { obsidian?: Partial<AppConfig['obsidian']> & { baseFile?: string } }): AppConfig {
    const oldObsidian = raw.obsidian as unknown as { vaultPath?: string; baseFiles?: string[]; baseFile?: string }
    const baseFiles = oldObsidian?.baseFiles && oldObsidian.baseFiles.length > 0
      ? oldObsidian.baseFiles
      : oldObsidian?.baseFile
        ? [oldObsidian.baseFile]
        : []
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      api: { ...DEFAULT_CONFIG.api, ...raw.api },
      obsidian: { vaultPath: oldObsidian?.vaultPath ?? DEFAULT_CONFIG.obsidian.vaultPath, baseFiles },
      persona: { ...DEFAULT_CONFIG.persona, ...(raw as Partial<AppConfig>).persona },
      petPosition: { ...DEFAULT_CONFIG.petPosition, ...raw.petPosition },
      triggers: this.mergeTriggers(raw.triggers ?? DEFAULT_CONFIG.triggers),
      reminders: { ...DEFAULT_CONFIG.reminders, ...raw.reminders }
    }
  }

  private mergeTriggers(raw: Partial<TriggerConfig>): TriggerConfig {
    return {
      ...DEFAULT_CONFIG.triggers,
      ...raw,
      phrases: { ...DEFAULT_CONFIG.triggers.phrases, ...(raw.phrases ?? {}) }
    }
  }

  get(): AppConfig {
    const api = this.getApiConfig()
    return { ...this.config, api }
  }

  save(cfg: AppConfig): void {
    this.config = this.merge(cfg)
    this.setApiConfig(cfg.api)
    const toSave = { ...this.config, api: { ...this.config.api, apiKey: '' } }
    writeFileSync(this.filePath, JSON.stringify(toSave, null, 2), 'utf-8')
  }

  private getApiConfig(): ApiConfig {
    const stored = this.config.api
    if (stored.apiKey && stored.apiKey !== '') return stored
    if (safeStorage.isEncryptionAvailable()) {
      const keyPath = this.filePath.replace('.json', '.key.enc')
      if (existsSync(keyPath)) {
        try {
          const encrypted = readFileSync(keyPath)
          const apiKey = safeStorage.decryptString(encrypted)
          return { ...stored, apiKey }
        } catch { /* ignore */ }
      }
    }
    return stored
  }

  private setApiConfig(api: ApiConfig): void {
    this.config.api = { ...api }
    if (safeStorage.isEncryptionAvailable() && api.apiKey) {
      const keyPath = this.filePath.replace('.json', '.key.enc')
      try {
        writeFileSync(keyPath, safeStorage.encryptString(api.apiKey))
      } catch { /* ignore */ }
    }
  }
}
