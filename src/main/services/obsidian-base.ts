import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import yaml from 'js-yaml'
import matter from 'gray-matter'
import type { TodoItem } from '../../shared/types'

interface BaseFile {
  filters?: unknown
  views?: Array<{ name?: string; filters?: unknown; order?: string[] }>
}

export class ObsidianBaseService {
  async getTodos(vaultPath: string, baseFile: string): Promise<TodoItem[]> {
    const root = this.resolveVault(vaultPath, baseFile)
    const folder = this.extractFolder(baseFile)
    const scanDir = folder ? join(root, folder) : dirname(baseFile)
    if (!existsSync(scanDir)) return []
    return readdirSync(scanDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => this.parseTodo(join(scanDir, entry.name), entry.name))
      .filter((todo): todo is TodoItem => todo !== null)
  }

  async addTodo(vaultPath: string, baseFile: string, title: string, content: string, priority = '', dueDate = ''): Promise<TodoItem> {
    const root = this.resolveVault(vaultPath, baseFile)
    const folder = this.extractFolder(baseFile)
    const scanDir = folder ? join(root, folder) : dirname(baseFile)
    if (!existsSync(scanDir)) mkdirSync(scanDir, { recursive: true })
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_')
    const filePath = join(scanDir, `${safeTitle}.md`)
    const body = [
      '---',
      '完成: false',
      priority ? `紧急程度: ${priority}` : '紧急程度:',
      dueDate ? `截止日期: ${dueDate}` : '截止日期:',
      '---',
      '',
      content
    ].join('\n')
    writeFileSync(filePath, body, 'utf-8')
    return this.parseTodo(filePath, `${safeTitle}.md`) as TodoItem
  }

  async completeTodo(filePath: string, completed: boolean): Promise<void> {
    if (!existsSync(filePath)) return
    const parsed = matter(readFileSync(filePath, 'utf-8'))
    const data = { ...parsed.data, 完成: completed }
    writeFileSync(filePath, `---\n${yaml.dump(data)}---\n\n${parsed.content}`, 'utf-8')
  }

  private parseTodo(filePath: string, name: string): TodoItem | null {
    try {
      const parsed = matter(readFileSync(filePath, 'utf-8'))
      return {
        filePath,
        title: basename(name, '.md'),
        content: parsed.content.trim(),
        completed: parsed.data['完成'] === true,
        priority: String(parsed.data['紧急程度'] ?? '').trim(),
        dueDate: parsed.data['截止日期'] ? String(parsed.data['截止日期']) : ''
      }
    } catch {
      return null
    }
  }

  private extractFolder(baseFile: string): string | null {
    if (!existsSync(baseFile)) return null
    try {
      const parsed = yaml.load(readFileSync(baseFile, 'utf-8')) as BaseFile
      const texts = JSON.stringify(parsed)
      const match = /file\.folder\s*==\s*["']([^"']+)["']/.exec(texts)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  private resolveVault(vaultPath: string, baseFile: string): string {
    if (vaultPath) return vaultPath
    let dir = dirname(baseFile)
    while (dir) {
      if (existsSync(join(dir, '.obsidian'))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return dirname(baseFile)
  }
}
