import type { ApiConfig, ChatMessage } from '../../shared/types'
import { ProxyAgent } from 'undici'

export class LLMClient {
  async chat(messages: ChatMessage[], config: ApiConfig, maxTokens?: number): Promise<string> {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new Error('API 未配置')
    }
    const endpoint = this.resolveEndpoint(config.baseUrl)
    let response: Response
    try {
      const dispatcher = config.proxy?.enabled && config.proxy.url
        ? new ProxyAgent(config.proxy.url)
        : undefined
      const requestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          ...(maxTokens ? { max_tokens: maxTokens } : {})
        }),
        dispatcher,
        signal: AbortSignal.timeout(30000)
      } as RequestInit
      response = await fetch(endpoint, requestInit)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(`网络请求失败: ${detail}`)
    }
    const raw = await response.text().catch(() => '')
    if (!response.ok) {
      throw new Error(`API 请求失败 (HTTP ${response.status})，endpoint=${endpoint}，返回=${raw.slice(0, 500)}`)
    }
    try {
      const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> }
      return data.choices?.[0]?.message?.content ?? ''
    } catch {
      throw new Error(`API 返回不是可解析的 JSON，endpoint=${endpoint}，返回=${raw.slice(0, 500)}`)
    }
  }

  /**
   * 兼容性处理：用户可能填根地址、带 /v1、或完整 /chat/completions 路径。
   */
  private resolveEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '')
    if (/\/chat\/completions$/i.test(trimmed)) return trimmed
    return `${trimmed}/chat/completions`
  }
}
