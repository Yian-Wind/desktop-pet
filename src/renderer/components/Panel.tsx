import { useState } from 'react'
import { MessageCircle, ListTodo, Settings, X } from 'lucide-react'
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
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <div className="panel-shell">
      <header className="panel-header">
        <div>
          <h1>Desktop Pet</h1>
          <p>Fairy · 待办与对话面板</p>
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
