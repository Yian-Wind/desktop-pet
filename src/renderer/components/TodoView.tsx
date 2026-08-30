import { useEffect, useState } from 'react'
import { CheckCircle2, Plus, RefreshCw } from 'lucide-react'
import type { TodoItem } from '../../shared/types'

export function TodoView() {
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [showForm, setShowForm] = useState(false)

  async function refresh() {
    const next = await window.petApi.getTodos()
    setTodos(next)
  }

  useEffect(() => { void refresh() }, [])

  async function add() {
    if (!title.trim()) return
    await window.petApi.addTodo(title.trim(), content.trim())
    setTitle('')
    setContent('')
    setShowForm(false)
    await refresh()
  }

  async function complete(todo: TodoItem) {
    await window.petApi.completeTodo(todo.filePath, !todo.completed)
    await refresh()
  }

  return (
    <div className="todo-layout">
      <div className="todo-toolbar">
        <button className="primary-button" onClick={() => void refresh()}>
          <RefreshCw size={15} /> 刷新
        </button>
        <button className="secondary-button" onClick={() => setShowForm((v) => !v)}>
          <Plus size={15} /> 新建待办
        </button>
      </div>
      {showForm ? (
        <div className="todo-form">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="待办标题" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="详情（可选）" rows={2} />
          <button className="primary-button" onClick={() => void add()}>保存</button>
        </div>
      ) : null}
      <div className="todo-list">
        {todos.length === 0 ? (
          <div className="empty-state">未找到待办，请先在设置中选择 .base 文件</div>
        ) : todos.map((todo) => (
          <div key={todo.filePath} className={`todo-card ${todo.completed ? 'todo-card--done' : ''}`}>
            <button className="icon-button" onClick={() => void complete(todo)} title={todo.completed ? '恢复' : '完成'}>
              <CheckCircle2 size={18} />
            </button>
            <div className="todo-card__body">
              <div className="todo-card__title">{todo.title}</div>
              {todo.dueDate || todo.priority ? (
                <div className="todo-card__meta">
                  {todo.priority ? <span>{todo.priority}</span> : null}
                  {todo.dueDate ? <span>截止 {todo.dueDate}</span> : null}
                </div>
              ) : null}
              {todo.content ? <div className="todo-card__content">{todo.content}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
