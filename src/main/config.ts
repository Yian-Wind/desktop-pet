import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig, ApiConfig } from '../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  api: { baseUrl: '', apiKey: '', model: '', proxy: { enabled: false, url: 'http://127.0.0.1:7897' } },
  obsidian: { vaultPath: '', baseFiles: [] },
  currentPackId: 'fairy',
  petPosition: { x: 100, y: 100 },
  petScales: {},
  coatStates: {},
  spine: { blinkIntervalSeconds: 4, sleepAnimationIntervalSeconds: 30 },
  reminders: { enabled: true, minIntervalMinutes: 30, startHour: 9, endHour: 22 },
  autostart: false,
  behaviorMode: 'rules',
  bubbleDurationSeconds: 5,
  todo: {
    filterPrompt: '优先3天内或已逾期的作业；其次#快速；再#长期。默认排除#等待和#备忘。',
    homeworkBaseFiles: []
  }
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
    if (!existsSync(this.filePath) && !existsSync(`${this.filePath}.bak`)) {
      return { ...DEFAULT_CONFIG, api: { ...DEFAULT_CONFIG.api } }
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      return this.merge(raw)
    } catch {
      if (existsSync(`${this.filePath}.bak`)) {
        try {
          const raw = JSON.parse(readFileSync(`${this.filePath}.bak`, 'utf-8'))
          return this.merge(raw)
        } catch { /* ignore */
        }
      }
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
    const coatStates: Record<string, boolean> = {}
    for (const [packId, on] of Object.entries(raw.coatStates ?? {})) {
      if (typeof on === 'boolean') coatStates[packId] = on
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
      coatStates,
      spine: {
        blinkIntervalSeconds: Number.isFinite(raw.spine?.blinkIntervalSeconds)
          ? Math.min(10, Math.max(1, Number(raw.spine?.blinkIntervalSeconds)))
          : DEFAULT_CONFIG.spine.blinkIntervalSeconds,
        sleepAnimationIntervalSeconds: Number.isFinite(raw.spine?.sleepAnimationIntervalSeconds)
          ? Math.min(300, Math.max(5, Number(raw.spine?.sleepAnimationIntervalSeconds)))
          : DEFAULT_CONFIG.spine.sleepAnimationIntervalSeconds
      },
      reminders: { ...DEFAULT_CONFIG.reminders, ...raw.reminders },
      bubbleDurationSeconds: Number.isFinite(raw.bubbleDurationSeconds)
        ? Math.min(20, Math.max(1, Number(raw.bubbleDurationSeconds)))
        : DEFAULT_CONFIG.bubbleDurationSeconds,
      todo: this.mergeTodoConfig(raw.todo, baseFiles)
    }
  }

  private mergeTodoConfig(
    raw: unknown,
    baseFiles: string[]
  ): AppConfig['todo'] {
    const source = (raw ?? {}) as {
      filterPrompt?: unknown
      homeworkBaseFiles?: unknown
      homeworkBaseNames?: unknown
    }
    const filterPrompt = typeof source.filterPrompt === 'string'
      ? source.filterPrompt.trim().slice(0, 1000)
      : DEFAULT_CONFIG.todo.filterPrompt

    if (Array.isArray(source.homeworkBaseFiles)) {
      return {
        filterPrompt,
        homeworkBaseFiles: source.homeworkBaseFiles
          .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
          .map((path) => path.trim())
          .slice(0, 20)
      }
    }

    const legacyNames = Array.isArray(source.homeworkBaseNames)
      ? source.homeworkBaseNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      : []
    return {
      filterPrompt,
      homeworkBaseFiles: baseFiles
        .filter((path) => legacyNames.some((name) => path.includes(name)))
        .slice(0, 20)
    }
  }

  get(): AppConfig {
    const api = this.getApiConfig()
    return { ...this.config, api }
  }

  private writeAtomic(filePath: string, data: string | Uint8Array): void {
    const tempPath = `${filePath}.tmp`
    const backupPath = `${filePath}.bak`
    writeFileSync(tempPath, data, 'utf-8')
    let usedFallback = false
    try {
      renameSync(tempPath, filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      usedFallback = true
      const destinationExisted = existsSync(filePath)
      if (destinationExisted) copyFileSync(filePath, backupPath)
      try {
        copyFileSync(tempPath, filePath)
      } catch (copyError) {
        if (destinationExisted) copyFileSync(backupPath, filePath)
        throw copyError
      }
    } finally {
      if (existsSync(tempPath)) unlinkSync(tempPath)
      if (usedFallback && existsSync(backupPath)) unlinkSync(backupPath)
    }
  }

  save(cfg: AppConfig): void {
    this.config = this.merge(cfg)
    this.setApiConfig(cfg.api)
    const toSave = { ...this.config, api: { ...this.config.api, apiKey: '' } }
    this.writeAtomic(this.filePath, JSON.stringify(toSave, null, 2))
  }

  private getApiConfig(): ApiConfig {
    const stored = this.config.api
    if (stored.apiKey && stored.apiKey !== '') return stored
    if (safeStorage.isEncryptionAvailable()) {
      const keyPath = this.filePath.replace('.json', '.key.enc')
      const backupPath = `${keyPath}.bak`
      for (const path of [keyPath, backupPath]) {
        if (!existsSync(path)) continue
        try {
          const encrypted = readFileSync(path)
          const apiKey = safeStorage.decryptString(encrypted)
          if (apiKey) return { ...stored, apiKey }
        } catch { /* try the next key file */ }
      }
    }
    return stored
  }

  private setApiConfig(api: ApiConfig): void {
    this.config.api = { ...api }
    if (safeStorage.isEncryptionAvailable() && api.apiKey) {
      const keyPath = this.filePath.replace('.json', '.key.enc')
      try {
        this.writeAtomic(keyPath, safeStorage.encryptString(api.apiKey))
      } catch { /* ignore */ }
    }
  }
}
