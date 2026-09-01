import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import yaml from 'js-yaml'
import matter from 'gray-matter'
import type { TodoItem } from '../../shared/types'

interface BaseFile {
  filters?: unknown
  formulas?: Record<string, string>
  views?: Array<{ name?: string; filters?: unknown; order?: string[] }>
}

export class ObsidianBaseService {
  async getTodos(vaultPath: string, baseFiles: string[]): Promise<TodoItem[]> {
    const out: TodoItem[] = []
    const seen = new Map<string, { todo: TodoItem; baseFile: string }>()
    for (const baseFile of baseFiles) {
      if (!baseFile) continue
      const root = this.resolveVault(vaultPath, baseFile)
      const folder = this.extractFolder(baseFile)
      const scanDir = folder ? join(root, folder) : dirname(baseFile)
      if (!existsSync(scanDir)) continue
      const baseName = basename(baseFile)
      const duePropertyName = this.resolveDuePropertyName(baseFile)
      const todos = readdirSync(scanDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => this.parseTodo(join(scanDir, entry.name), entry.name, baseFile, baseName, duePropertyName))
        .filter((todo): todo is TodoItem => todo !== null)
      for (const todo of todos) {
        const existing = seen.get(todo.filePath)
        if (!existing || baseFile.length > existing.baseFile.length) {
          seen.set(todo.filePath, { todo, baseFile })
        }
      }
    }
    out.push(...[...seen.values()].map((entry) => entry.todo))
    return out
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
    return this.parseTodo(filePath, `${safeTitle}.md`, basename(baseFile)) as TodoItem
  }

  async completeTodo(filePath: string, completed: boolean): Promise<void> {
    if (!existsSync(filePath)) return
    const parsed = matter(readFileSync(filePath, 'utf-8'))
    const data = { ...parsed.data, 完成: completed }
    writeFileSync(filePath, `---\n${yaml.dump(data)}---\n\n${parsed.content}`, 'utf-8')
  }

  private parseTodo(
    filePath: string,
    name: string,
    baseFile?: string,
    baseName?: string,
    duePropertyName = '截止日期'
  ): TodoItem | null {
    try {
      const parsed = matter(readFileSync(filePath, 'utf-8'))
      const dueDate = parsed.data[duePropertyName] ? String(parsed.data[duePropertyName]) : ''
      return {
        filePath,
        title: basename(name, '.md'),
        content: parsed.content.trim(),
        completed: this.isCompleted(parsed.data['完成']),
        priority: String(parsed.data['紧急程度'] ?? '').trim(),
        dueDate,
        tags: this.parseTags(parsed.data.tags ?? parsed.data.tag, parsed.content),
        remainingDays: this.calculateRemainingDays(dueDate),
        baseFile,
        baseName
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

  private resolveDuePropertyName(baseFile: string): string {
    if (!existsSync(baseFile)) return '截止日期'
    try {
      const parsed = yaml.load(readFileSync(baseFile, 'utf-8')) as BaseFile
      const formulaText = Object.values(parsed.formulas ?? {}).join('\n')
      const match = /date\(([^)]+)\)/.exec(formulaText)
      return match?.[1]?.trim() || '截止日期'
    } catch {
      return '截止日期'
    }
  }

  private parseTags(value: unknown, content: string): string[] {
    const values = Array.isArray(value)
      ? value.map(String)
      : typeof value === 'string'
        ? value.split(/[,，\s]+/)
        : []
    const inlineTags = content.match(/#[^\s#，。；;]+/g) ?? []
    return [...values, ...inlineTags]
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .map((tag) => tag.toLowerCase())
      .filter((tag, index, tags) => tags.indexOf(tag) === index)
  }

  private calculateRemainingDays(value: string): number | null {
    const parsedDate = new Date(value)
    if (Number.isNaN(parsedDate.getTime())) return null
    const due = Date.UTC(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate())
    const now = new Date()
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    return Math.round((due - today) / 86_400_000)
  }

  private isCompleted(value: unknown): boolean {
    return value === true || value === 'true'
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
