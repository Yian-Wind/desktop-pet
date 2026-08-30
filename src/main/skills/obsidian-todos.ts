import type { Skill, SkillResult } from '../../shared/types'

export function createTodoSkill(): Skill {
  return {
    name: 'obsidian-todos',
    description: '查询和管理 Obsidian 待办',
    async execute(params, context) {
      const { action } = params as { action: string }
      if (action === 'list') {
        const svc = context.obsidian as { getTodos: () => Promise<unknown[]> }
        const todos = await svc.getTodos()
        return { success: true, data: todos }
      }
      return { success: false, error: '不支持的操作' }
    }
  }
}
