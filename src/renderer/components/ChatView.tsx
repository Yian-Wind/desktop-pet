import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import type { ChatMessage, PetPack } from '../../shared/types'

export function ChatView() {
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [packName, setPackName] = useState('Fairy')

  useEffect(() => {
    let disposed = false
    async function init() {
      const cfg = await window.petApi.getConfig()
      const packList = await window.petApi.listPacks()
      const current = packList.find((p) => p.manifest.id === cfg.currentPackId) ?? packList[0]
      if (disposed) return
      setPackName(current?.manifest.name ?? 'Fairy')
      setHistory(await window.petApi.getChatHistory())
    }
    void init()
    const unsubscribe = window.petApi.onPackChanged((next: PetPack) => {
      if (disposed) return
      setPackName(next.manifest.name)
      void window.petApi.getChatHistory().then(setHistory)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setBusy(true)
    setInput('')
    setHistory((prev) => [...prev, { role: 'user', content: text, timestamp: Date.now() }])
    const result = await window.petApi.sendChat(text)
    if ('error' in result) {
      setHistory((prev) => [...prev, { role: 'assistant', content: result.error, timestamp: Date.now() }])
    } else {
      setHistory((prev) => [...prev, result])
    }
    setBusy(false)
  }

  return (
    <div className="chat-layout">
      <div className="chat-history">
        {history.length === 0 ? (
          <div className="empty-state">和 {packName} 聊聊今天的安排吧</div>
        ) : (
          history.map((message, index) => (
            <div key={index} className={`chat-message chat-message--${message.role}`}>
              <div className="chat-message__role">{message.role === 'user' ? '你' : packName}</div>
              <div>{message.content}</div>
            </div>
          ))
        )}
      </div>
      <div className="chat-composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder="输入消息，Enter 发送"
          rows={3}
        />
        <button className="primary-button" onClick={() => void send()} disabled={busy}>
          <Send size={16} />
          {busy ? '发送中' : '发送'}
        </button>
      </div>
    </div>
  )
}
