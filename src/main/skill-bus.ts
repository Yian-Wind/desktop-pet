import type { Skill, SkillContext, SkillResult } from '../shared/types'

export class SkillBus {
  private skills = new Map<string, Skill>()

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  async execute(name: string, params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const skill = this.skills.get(name)
    if (!skill) return { success: false, error: `未知技能: ${name}` }
    return skill.execute(params, context)
  }

  list(): Array<{ name: string; description: string }> {
    return Array.from(this.skills.values()).map(s => ({ name: s.name, description: s.description }))
  }
}
