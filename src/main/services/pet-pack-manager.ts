import { app } from 'electron'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PetPack, PetPackManifest } from '../../shared/types'

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
      const manifestPath = join(packsRoot, entry.name, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PetPackManifest
        const rootDir = join(packsRoot, entry.name)
        const assets: Record<string, string> = {}
        for (const [key, rel] of Object.entries(manifest.assetPaths ?? {})) {
          assets[key] = join('packs', entry.name, rel).split('\\').join('/')
        }
        this.packs.set(manifest.id, { manifest, rootDir, assets })
      } catch { /* skip invalid pack */ }
    }
  }

  list(): PetPack[] {
    return Array.from(this.packs.values())
  }

  get(id: string): PetPack | undefined {
    return this.packs.get(id)
  }
}
