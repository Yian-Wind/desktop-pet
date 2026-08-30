import type { Skill, SkillResult, ChatMessage } from '../../shared/types'

export function createChatSkill(): Skill {
  return {
    name: 'chat',
    description: 'AI 对话，宠物会以角色身份回复',
    async execute(params, context) {
      const { messages } = params as { messages: ChatMessage[] }
      if (!context.llm || !('chat' in (context.llm as object))) {
        return { success: false, error: 'LLM 未初始化' }
      }
      try {
        const llm = context.llm as { chat: (msgs: ChatMessage[], config: unknown) => Promise<string> }
        const reply = await llm.chat(messages, context.config.api)
        return { success: true, data: reply, bubble: reply }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  }
}
