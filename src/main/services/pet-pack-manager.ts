import { app } from 'electron'
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CORPUS, EMPTY_PERSONA } from '../../shared/defaults'
import type { CorpusConfig, PersonaConfig, PetPack, PetPackManifest } from '../../shared/types'

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function mergeCorpus(raw: Partial<CorpusConfig> | null | undefined): CorpusConfig {
  return {
    ...DEFAULT_CORPUS,
    ...raw,
    phrases: { ...DEFAULT_CORPUS.phrases, ...(raw?.phrases ?? {}) }
  }
}

export class PetPackManager {
  private packs = new Map<string, PetPack>()

  constructor() {
    this.scan()
  }

  private scan(): void {
    const packsRoot = join(app.getAppPath(), 'packs')
    if (!existsSync(packsRoot)) return
    for (const entry of readdirSync(packsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packDir = join(packsRoot, entry.name)
      const manifestPath = join(packDir, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PetPackManifest
        const assets: Record<string, string> = {}
        for (const [key, rel] of Object.entries(manifest.assetPaths ?? {})) {
          assets[key] = join('packs', entry.name, rel).split('\\').join('/')
        }
        const persona = readJson<PersonaConfig>(join(packDir, 'persona.json')) ?? manifest.persona ?? EMPTY_PERSONA
        const corpus = mergeCorpus(readJson<Partial<CorpusConfig>>(join(packDir, 'corpus.json')))
        this.packs.set(manifest.id, { manifest, rootDir: packDir, assets, persona, corpus })
      } catch { /* skip invalid pack */ }
    }
  }

  list(): PetPack[] {
    return Array.from(this.packs.values())
  }

  get(id: string): PetPack | undefined {
    return this.packs.get(id)
  }

  savePersona(packId: string, persona: PersonaConfig): PetPack | null {
    const pack = this.packs.get(packId)
    if (!pack) return null
    writeFileSync(join(pack.rootDir, 'persona.json'), JSON.stringify(persona, null, 2), 'utf-8')
    const next = { ...pack, persona }
    this.packs.set(packId, next)
    return next
  }

  saveCorpus(packId: string, corpus: CorpusConfig): PetPack | null {
    const pack = this.packs.get(packId)
    if (!pack) return null
    const merged = mergeCorpus(corpus)
    writeFileSync(join(pack.rootDir, 'corpus.json'), JSON.stringify(merged, null, 2), 'utf-8')
    const next = { ...pack, corpus: merged }
    this.packs.set(packId, next)
    return next
  }
}
