import { useEffect, useState } from 'react'
import { MessageCircle, ListTodo, Settings, X } from 'lucide-react'
import type { PetPack } from '../../shared/types'
import { ChatView } from './ChatView'
import { TodoView } from './TodoView'
import { SettingsView } from './SettingsView'

type Tab = 'chat' | 'todos' | 'settings'

const tabs: Array<{ id: Tab; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: '对话', icon: MessageCircle },
  { id: 'todos', label: '待办', icon: ListTodo },
  { id: 'settings', label: '设置', icon: Settings }
]

export function Panel() {
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    return requested === 'todos' || requested === 'settings' ? requested : 'chat'
  })
  const [pack, setPack] = useState<PetPack | null>(null)

  useEffect(() => {
    let disposed = false
    async function init() {
      const cfg = await window.petApi.getConfig()
      const packList = await window.petApi.listPacks()
      const current = packList.find((p) => p.manifest.id === cfg.currentPackId) ?? packList[0]
      if (!disposed) setPack(current ?? null)
    }
    void init()
    const unsubscribe = window.petApi.onPackChanged((next) => setPack(next))
    const unsubscribeTab = window.petApi.onPanelTabChanged((next) => {
      if (next === 'chat' || next === 'todos' || next === 'settings') setTab(next)
    })
    return () => {
      disposed = true
      unsubscribe()
      unsubscribeTab()
    }
  }, [])

  return (
    <div className="panel-shell">
      <header className="panel-header">
        <div>
          <h1>Desktop Pet</h1>
          <p>{pack ? `${pack.manifest.name} · 待办与对话面板` : '待办与对话面板'}</p>
        </div>
        <button className="icon-button" onClick={() => window.petApi.closePanel()} title="关闭">
          <X size={18} />
        </button>
      </header>
      <nav className="panel-tabs">
        {tabs.map((tabItem) => {
          const Icon = tabItem.icon
          return (
            <button
              key={tabItem.id}
              className={tab === tabItem.id ? 'active' : ''}
              onClick={() => setTab(tabItem.id)}
            >
              <Icon size={16} />
              {tabItem.label}
            </button>
          )
        })}
      </nav>
      <main className="panel-main">
        {tab === 'chat' && <ChatView />}
        {tab === 'todos' && <TodoView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}
