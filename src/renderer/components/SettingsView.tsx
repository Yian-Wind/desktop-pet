import { useEffect, useState } from 'react'
import { Save, FlaskConical } from 'lucide-react'
import type { AppConfig } from '../../shared/types'

export function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [packs, setPacks] = useState<Array<{ manifest: { id: string; name: string; type: string } }>>([])
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void Promise.all([window.petApi.getConfig(), window.petApi.listPacks()]).then(([cfg, packList]) => {
      setConfig(cfg)
      setPacks(packList)
    })
  }, [])

  if (!config) return <div className="empty-state">加载中...</div>

  function update(patch: Partial<AppConfig>) {
    setConfig({ ...config, ...patch })
    setSaved(false)
  }

  function updateApi(patch: Partial<AppConfig['api']>) {
    update({ api: { ...config.api, ...patch } })
  }

  function updateObsidian(patch: Partial<AppConfig['obsidian']>) {
    update({ obsidian: { ...config.obsidian, ...patch } })
  }

  function updateTriggers(patch: Partial<AppConfig['triggers']>) {
    update({ triggers: { ...config.triggers, ...patch } })
  }

  function updatePhrase(key: string, index: number, value: string) {
    const next = { ...config.triggers.phrases }
    const list = [...(next[key] ?? [])]
    list[index] = value
    next[key] = list
    update({ triggers: { ...config.triggers, phrases: next } })
  }

  function addPhrase(key: string) {
    const next = { ...config.triggers.phrases }
    next[key] = [...(next[key] ?? []), '']
    update({ triggers: { ...config.triggers, phrases: next } })
  }

  function removePhrase(key: string, index: number) {
    const next = { ...config.triggers.phrases }
    const list = [...(next[key] ?? [])]
    list.splice(index, 1)
    next[key] = list
    update({ triggers: { ...config.triggers, phrases: next } })
  }

  function updateReminders(patch: Partial<AppConfig['reminders']>) {
    update({ reminders: { ...config.reminders, ...patch } })
  }

  async function save() {
    await window.petApi.saveConfig(config)
    window.petApi.setPetSize(config.petPosition.scale)
    setSaved(true)
  }

  async function runTest() {
    setTesting(true)
    setTestResult(null)
    const res = await window.petApi.testChat()
    if (res.ok) setTestResult(res.reply ?? 'OK')
    else setTestResult(res.error ?? '测试失败')
    setTesting(false)
  }

  const triggerKeys = ['click', 'drag-end', 'idle', 'sleep', 'wake'] as const
  const triggerLabels: Record<string, string> = {
    click: '点击',
    'drag-end': '拖拽结束',
    idle: '空闲',
    sleep: '睡觉',
    wake: '唤醒'
  }

  return (
    <div className="settings-layout">
      <section className="settings-section">
        <h2>API</h2>
        <label>Base URL
          <input value={config.api.baseUrl} onChange={(e) => updateApi({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
        </label>
        <label>API Key
          <input type="password" value={config.api.apiKey} onChange={(e) => updateApi({ apiKey: e.target.value })} placeholder="sk-..." />
        </label>
        <label>Model
          <input value={config.api.model} onChange={(e) => updateApi({ model: e.target.value })} placeholder="model-name" />
        </label>
        <div className="settings-row">
          <button className="secondary-button" onClick={() => void runTest()} disabled={testing}>
            <FlaskConical size={15} /> {testing ? '测试中…' : '测试扮演'}
          </button>
          {testResult ? <span className="test-result">{testResult}</span> : null}
        </div>
      </section>

      <section className="settings-section">
        <h2>Obsidian</h2>
        <label>Vault 路径
          <input value={config.obsidian.vaultPath} onChange={(e) => updateObsidian({ vaultPath: e.target.value })} placeholder="D:/.../Vault" />
        </label>
        <label>.base 文件路径
          <input value={config.obsidian.baseFile} onChange={(e) => updateObsidian({ baseFile: e.target.value })} placeholder="D:/.../视图.base" />
        </label>
      </section>

      <section className="settings-section">
        <h2>角色</h2>
        <div className="settings-row">
          {packs.map((pack) => (
            <button
              key={pack.manifest.id}
              className={config.currentPackId === pack.manifest.id ? 'pack-button active' : 'pack-button'}
              onClick={() => { void window.petApi.switchPack(pack.manifest.id); update({ currentPackId: pack.manifest.id }) }}
            >
              {pack.manifest.name} · {pack.manifest.type}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>宠物</h2>
        <label>大小比例（当前 {config.petPosition.scale}×）
          <input type="range" min={0.5} max={2} step={0.1} value={config.petPosition.scale}
            onChange={(e) => update({ petPosition: { ...config.petPosition, scale: Number(e.target.value) } })} />
        </label>
      </section>

      <section className="settings-section">
        <h2>触发语料</h2>
        <label className="checkbox-row">
          <input type="checkbox" checked={config.triggers.enabled} onChange={(e) => updateTriggers({ enabled: e.target.checked })} />
          启用主动触发
        </label>
        <div className="settings-row">
          <label>空闲提醒（分钟）
            <input type="number" min={1} value={config.triggers.idleAfterMinutes}
              onChange={(e) => updateTriggers({ idleAfterMinutes: Number(e.target.value) })} />
          </label>
          <label>睡觉（分钟）
            <input type="number" min={2} value={config.triggers.sleepAfterMinutes}
              onChange={(e) => updateTriggers({ sleepAfterMinutes: Number(e.target.value) })} />
          </label>
          <label>提醒冷却（分钟）
            <input type="number" min={1} value={config.triggers.idleCooldownMinutes}
              onChange={(e) => updateTriggers({ idleCooldownMinutes: Number(e.target.value) })} />
          </label>
        </div>
        {triggerKeys.map((key) => (
          <div className="phrase-group" key={key}>
            <label className="phrase-label">{triggerLabels[key]}</label>
            {(config.triggers.phrases[key] ?? []).map((phrase, i) => (
              <div className="phrase-row" key={i}>
                <input value={phrase} onChange={(e) => updatePhrase(key, i, e.target.value)} placeholder="触发语料" />
                <button className="icon-button" onClick={() => removePhrase(key, i)} title="删除">×</button>
              </div>
            ))}
            <button className="secondary-button phrase-add" onClick={() => addPhrase(key)}>+ 添加</button>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h2>提醒</h2>
        <label className="checkbox-row">
          <input type="checkbox" checked={config.reminders.enabled} onChange={(e) => updateReminders({ enabled: e.target.checked })} />
          启用主动提醒
        </label>
        <label>提醒间隔（分钟）
          <input type="number" value={config.reminders.minIntervalMinutes} onChange={(e) => updateReminders({ minIntervalMinutes: Number(e.target.value) })} />
        </label>
        <div className="settings-row">
          <label>开始
            <input type="number" min={0} max={23} value={config.reminders.startHour} onChange={(e) => updateReminders({ startHour: Number(e.target.value) })} />
          </label>
          <label>结束
            <input type="number" min={0} max={23} value={config.reminders.endHour} onChange={(e) => updateReminders({ endHour: Number(e.target.value) })} />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h2>行为与启动</h2>
        <label className="checkbox-row">
          <input type="checkbox" checked={config.autostart} onChange={(e) => update({ autostart: e.target.checked })} />
          开机自启
        </label>
        <label>行为模式
          <select value={config.behaviorMode} onChange={(e) => update({ behaviorMode: e.target.value as 'rules' | 'llm' })}>
            <option value="rules">规则驱动（Fairy 默认）</option>
            <option value="llm">LLM 决策（预留）</option>
          </select>
        </label>
      </section>

      <div className="settings-actions">
        <button className="primary-button" onClick={() => void save()}>
          <Save size={16} /> 保存设置
        </button>
        {saved ? <span className="saved-hint">已保存</span> : null}
      </div>
    </div>
  )
}
