import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig, ApiConfig } from '../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  api: { baseUrl: '', apiKey: '', model: '', proxy: { enabled: false, url: 'http://127.0.0.1:7897' } },
  obsidian: { vaultPath: '', baseFiles: [] },
  currentPackId: 'fairy',
  petPosition: { x: 100, y: 100 },
  petScales: {},
  spine: { blinkIntervalSeconds: 4 },
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

  private merge(raw: Partial<AppConfig> & {
    obsidian?: Partial<AppConfig['obsidian']> & { baseFile?: string }
    petPosition?: Partial<AppConfig['petPosition']> & { scale?: number }
  }): AppConfig {
    const oldObsidian = raw.obsidian as unknown as { vaultPath?: string; baseFiles?: string[]; baseFile?: string }
    const oldPetPosition = raw.petPosition
    const currentPackId = raw.currentPackId ?? DEFAULT_CONFIG.currentPackId
    const petScales: Record<string, number> = {}
    for (const [packId, scale] of Object.entries(raw.petScales ?? {})) {
      if (Number.isFinite(scale)) petScales[packId] = scale
    }
    if (oldPetPosition?.scale !== undefined && Number.isFinite(oldPetPosition.scale) && petScales[currentPackId] === undefined) {
      petScales[currentPackId] = oldPetPosition.scale
    }
    const baseFiles = oldObsidian?.baseFiles && oldObsidian.baseFiles.length > 0
      ? oldObsidian.baseFiles
      : oldObsidian?.baseFile
        ? [oldObsidian.baseFile]
        : []
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      api: { ...DEFAULT_CONFIG.api, ...raw.api, proxy: { ...DEFAULT_CONFIG.api.proxy, ...raw.api?.proxy } },
      obsidian: { vaultPath: oldObsidian?.vaultPath ?? DEFAULT_CONFIG.obsidian.vaultPath, baseFiles },
      petPosition: {
        x: oldPetPosition?.x ?? DEFAULT_CONFIG.petPosition.x,
        y: oldPetPosition?.y ?? DEFAULT_CONFIG.petPosition.y
      },
      petScales,
      spine: {
        blinkIntervalSeconds: Number.isFinite(raw.spine?.blinkIntervalSeconds)
          ? Math.min(10, Math.max(1, Number(raw.spine?.blinkIntervalSeconds)))
          : DEFAULT_CONFIG.spine.blinkIntervalSeconds
      },
      reminders: { ...DEFAULT_CONFIG.reminders, ...raw.reminders }
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
