import type { ApiConfig, ChatMessage } from '../../shared/types'

export class LLMClient {
  async chat(messages: ChatMessage[], config: ApiConfig): Promise<string> {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new Error('API 未配置')
    }
    const endpoint = config.baseUrl.replace(/\/?$/, '') + '/chat/completions'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content }))
      }),
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`API 请求失败 (${response.status}): ${text}`)
    }
    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }
}
