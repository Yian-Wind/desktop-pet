import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, FlaskConical, FolderOpen, Loader2, PenLine, Save } from 'lucide-react'
import type { AppConfig, CorpusConfig, PersonaConfig, PetPack } from '../../shared/types'
import { DEFAULT_CORPUS } from '../../shared/defaults'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [packs, setPacks] = useState<PetPack[]>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [personaJson, setPersonaJson] = useState('')
  const [corpusJson, setCorpusJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [savingJson, setSavingJson] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const corpusSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCorpusRef = useRef<{ packId: string; corpus: CorpusConfig } | null>(null)

  useEffect(() => {
    let disposed = false
    void Promise.all([window.petApi.getConfig(), window.petApi.listPacks()]).then(([cfg, packList]) => {
      if (disposed) return
      setConfig(cfg)
      setPacks(packList)
      const current = packList.find((p) => p.manifest.id === cfg.currentPackId) ?? packList[0]
      if (current) {
        setPersonaJson(stringify(current.persona))
        setCorpusJson(stringify(current.corpus))
      }
    })
    const unsubscribe = window.petApi.onPackChanged((pack) => {
      if (disposed) return
      setPacks((prev) => prev.map((p) => (p.manifest.id === pack.manifest.id ? pack : p)))
      setPersonaJson(stringify(pack.persona))
      setCorpusJson(stringify(pack.corpus))
      setJsonError(null)
    })
    return () => {
      disposed = true
      unsubscribe()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (corpusSaveTimer.current) clearTimeout(corpusSaveTimer.current)
      const pendingCorpus = pendingCorpusRef.current
      if (pendingCorpus) void window.petApi.saveCorpus(pendingCorpus.packId, pendingCorpus.corpus)
    }
  }, [])

  if (!config) return <div className="empty-state">加载中...</div>
  const cfg = config
  const currentPack = packs.find((p) => p.manifest.id === cfg.currentPackId) ?? packs[0]
  const currentScale = cfg.petScales[cfg.currentPackId] ?? currentPack?.manifest.defaultScale ?? 1

  async function persist(next: AppConfig) {
    try {
      const saved = await window.petApi.saveConfig(next)
      setConfig(saved)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  function commit(next: AppConfig, delayMs = 300) {
    setConfig(next)
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (delayMs === 0) {
      void persist(next)
      return
    }
    saveTimer.current = setTimeout(async () => {
      void persist(next)
    }, delayMs)
  }

  function update(patch: Partial<AppConfig>) {
    commit({ ...cfg, ...patch })
  }

  function updateApi(patch: Partial<AppConfig['api']>, immediate = false) {
    commit({ ...cfg, api: { ...cfg.api, ...patch } }, immediate ? 0 : 300)
  }

  function updateProxy(patch: Partial<AppConfig['api']['proxy']>) {
    update({ api: { ...cfg.api, proxy: { ...cfg.api.proxy, ...patch } } })
  }

  function updateObsidian(patch: Partial<AppConfig['obsidian']>) {
    update({ obsidian: { ...cfg.obsidian, ...patch } })
  }

  function updateReminders(patch: Partial<AppConfig['reminders']>) {
    update({ reminders: { ...cfg.reminders, ...patch } })
  }

  function updateSpine(patch: Partial<AppConfig['spine']>) {
    update({ spine: { ...cfg.spine, ...patch } })
  }

  async function persistCorpus(packId: string, corpus: CorpusConfig) {
    try {
      const saved = await window.petApi.saveCorpus(packId, corpus)
      if (!saved) throw new Error('未找到角色包')
      setPacks((prev) => prev.map((p) => (p.manifest.id === packId ? saved : p)))
      setCorpusJson(stringify(saved.corpus))
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  function commitCorpus(next: CorpusConfig, delayMs = 300) {
    if (!currentPack) return
    const packId = currentPack.manifest.id
    setPacks((prev) => prev.map((p) => (p.manifest.id === packId ? { ...p, corpus: next } : p)))
    setCorpusJson(stringify(next))
    setSaveState('saving')
    pendingCorpusRef.current = { packId, corpus: next }
    if (corpusSaveTimer.current) clearTimeout(corpusSaveTimer.current)
    if (delayMs === 0) {
      pendingCorpusRef.current = null
      void persistCorpus(packId, next)
      return
    }
    corpusSaveTimer.current = setTimeout(() => {
      pendingCorpusRef.current = null
      void persistCorpus(packId, next)
    }, delayMs)
  }

  function updateSleepAfterMinutes(minutes: number) {
    if (!currentPack) return
    commitCorpus({
      ...currentPack.corpus,
      sleepAfterMinutes: Math.min(60, Math.max(1, minutes))
    })
  }

  function addBase() {
    update({ obsidian: { ...cfg.obsidian, baseFiles: [...cfg.obsidian.baseFiles, ''] } })
  }

  function removeBase(index: number) {
    const list = [...cfg.obsidian.baseFiles]
    list.splice(index, 1)
    update({ obsidian: { ...cfg.obsidian, baseFiles: list } })
  }

  function updateBase(index: number, value: string) {
    const list = [...cfg.obsidian.baseFiles]
    list[index] = value
    update({ obsidian: { ...cfg.obsidian, baseFiles: list } })
  }

  function updateScale(scale: number) {
    commit(
      { ...cfg, petScales: { ...cfg.petScales, [cfg.currentPackId]: scale } },
      0
    )
  }

  async function switchPack(packId: string) {
    const nextPack = packs.find((p) => p.manifest.id === packId)
    if (!nextPack || packId === cfg.currentPackId) return
    update({ currentPackId: packId })
    const saved = await window.petApi.switchPack(packId)
    if (saved) {
      setPacks((prev) => prev.map((p) => (p.manifest.id === saved.manifest.id ? saved : p)))
      setPersonaJson(stringify(saved.persona))
      setCorpusJson(stringify(saved.corpus))
      setJsonError(null)
    }
  }

  async function savePersona() {
    if (!currentPack) return
    setSavingJson(true)
    setJsonError(null)
    try {
      const parsed = JSON.parse(personaJson) as PersonaConfig
      if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !parsed.name.trim()) {
        throw new Error('persona.json 必须包含非空的字符串字段 name')
      }
      const saved = await window.petApi.savePersona(currentPack.manifest.id, parsed)
      if (saved) {
        setPacks((prev) => prev.map((p) => (p.manifest.id === saved.manifest.id ? saved : p)))
        setPersonaJson(stringify(saved.persona))
      }
      setSaveState('saved')
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e))
      setSaveState('error')
    } finally {
      setSavingJson(false)
    }
  }

  async function saveCorpus() {
    if (!currentPack) return
    setSavingJson(true)
    setJsonError(null)
    try {
      const parsed = JSON.parse(corpusJson) as Partial<CorpusConfig>
      if (!parsed || typeof parsed !== 'object') throw new Error('corpus.json 必须是一个对象')
      const merged: CorpusConfig = {
        ...DEFAULT_CORPUS,
        ...parsed,
        phrases: { ...DEFAULT_CORPUS.phrases, ...(parsed.phrases ?? {}) }
      }
      const saved = await window.petApi.saveCorpus(currentPack.manifest.id, merged)
      if (saved) {
        setPacks((prev) => prev.map((p) => (p.manifest.id === saved.manifest.id ? saved : p)))
        setCorpusJson(stringify(saved.corpus))
      }
      setSaveState('saved')
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e))
      setSaveState('error')
    } finally {
      setSavingJson(false)
    }
  }

  async function openPackDir() {
    if (!currentPack) return
    await window.petApi.openPackDir(currentPack.manifest.id)
  }

  async function runTest() {
    setTesting(true)
    setTestResult(null)
    const res = await window.petApi.testChat()
    if (res.ok) setTestResult(res.reply ?? 'OK')
    else setTestResult(res.error ?? '测试失败')
    setTesting(false)
  }

  const saveBadge = {
    saving: <><Loader2 size={13} className="spin" /> 保存中…</>,
    saved: <><Check size={13} /> 已保存</>,
    error: <><PenLine size={13} /> 保存失败</>,
    idle: <>修改自动保存</>
  }[saveState]

  return (
    <div className="settings-layout">
      <div className={`save-bar save-bar--${saveState}`}>
        {saveBadge}
      </div>

      <section className="settings-section role-switcher">
        <div className="section-head">
          <h2>角色</h2>
          <span>切换角色会同时切换人设、语料响应规则与聊天上下文</span>
        </div>
        <div className="settings-row role-switcher__row">
          {packs.map((pack) => (
            <button
              key={pack.manifest.id}
              className={cfg.currentPackId === pack.manifest.id ? 'pack-button active' : 'pack-button'}
              onClick={() => void switchPack(pack.manifest.id)}
            >
              <strong>{pack.manifest.name}</strong>
              <span>{pack.manifest.type}</span>
            </button>
          ))}
        </div>
      </section>

      {currentPack ? (
        <>
          <section className="settings-section">
            <div className="section-head">
              <h2>人设配置</h2>
              <span>packs/{currentPack.manifest.id}/persona.json</span>
            </div>
            <textarea
              className="json-editor"
              rows={12}
              value={personaJson}
              onChange={(e) => { setPersonaJson(e.target.value); setJsonError(null) }}
              spellCheck={false}
            />
            <div className="settings-actions">
              <button className="primary-button" onClick={() => void savePersona()} disabled={savingJson}>
                <Save size={15} /> 保存人设 JSON
              </button>
              <button className="secondary-button" onClick={() => void openPackDir()}>
                <FolderOpen size={15} /> 打开配置目录
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="section-head">
              <h2>语料响应规则表</h2>
              <span>packs/{currentPack.manifest.id}/corpus.json · click / drag-end / idle / sleep / wake</span>
            </div>
            <textarea
              className="json-editor"
              rows={14}
              value={corpusJson}
              onChange={(e) => { setCorpusJson(e.target.value); setJsonError(null) }}
              spellCheck={false}
            />
            <div className="settings-actions">
              <button className="primary-button" onClick={() => void saveCorpus()} disabled={savingJson}>
                <Save size={15} /> 保存语料 JSON
              </button>
            </div>
          </section>

          {jsonError ? (
            <div className="json-error">
              <AlertCircle size={14} /> {jsonError}
            </div>
          ) : null}
        </>
      ) : null}

      <section className="settings-section">
        <h2>API</h2>
        <label>Base URL
          <input value={cfg.api.baseUrl} onChange={(e) => updateApi({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
        </label>
        <label>API Key
          <input type="password" value={cfg.api.apiKey} onChange={(e) => updateApi({ apiKey: e.target.value }, true)} placeholder="sk-..." />
        </label>
        <label>Model
          <input value={cfg.api.model} onChange={(e) => updateApi({ model: e.target.value })} placeholder="model-name" />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={cfg.api.proxy.enabled} onChange={(e) => updateProxy({ enabled: e.target.checked })} />
          通过本地代理访问 API
        </label>
        <label>代理地址
          <input value={cfg.api.proxy.url} onChange={(e) => updateProxy({ url: e.target.value })} placeholder="http://127.0.0.1:7897" />
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
          <input value={cfg.obsidian.vaultPath} onChange={(e) => updateObsidian({ vaultPath: e.target.value })} placeholder="D:/.../Vault" />
        </label>
        <div className="phrase-group">
          <label className="phrase-label">Base 文件（可多条）</label>
          {cfg.obsidian.baseFiles.map((path, index) => (
            <div className="phrase-row" key={index}>
              <input value={path} onChange={(e) => updateBase(index, e.target.value)} placeholder="D:/.../视图.base" />
              <button className="icon-button" onClick={() => removeBase(index)} title="删除">×</button>
            </div>
          ))}
          <button className="secondary-button phrase-add" onClick={addBase}>+ 添加 Base</button>
        </div>
      </section>

      <section className="settings-section">
        <h2>宠物</h2>
        {currentPack ? (
          <label>进入长待机（当前 {currentPack.corpus.sleepAfterMinutes} 分钟）
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={currentPack.corpus.sleepAfterMinutes}
              onChange={(e) => updateSleepAfterMinutes(Number(e.target.value))}
            />
          </label>
        ) : null}
        <label>大小比例（{currentPack?.manifest.name ?? cfg.currentPackId} 当前 {currentScale}×）
          <input type="range" min={0.2} max={2} step={0.1} value={currentScale}
            onChange={(e) => updateScale(Number(e.target.value))} />
        </label>
        <label>眨眼间隔（当前 {cfg.spine.blinkIntervalSeconds} 秒）
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={cfg.spine.blinkIntervalSeconds}
            onChange={(e) => updateSpine({ blinkIntervalSeconds: Number(e.target.value) })}
          />
        </label>
        <label>长待机动画间隔（当前 {cfg.spine.sleepAnimationIntervalSeconds} 秒）
          <input
            type="range"
            min={5}
            max={300}
            step={5}
            value={cfg.spine.sleepAnimationIntervalSeconds}
            onChange={(e) => updateSpine({ sleepAnimationIntervalSeconds: Number(e.target.value) })}
          />
        </label>
        {currentPack?.manifest.type === 'spine' && currentPack.manifest.animations.includes('举手张嘴') ? (
          <button className="secondary-button" onClick={() => void window.petApi.sendPetEvent({ type: 'cheer' })}>
            测试举手张嘴表情
          </button>
        ) : null}
      </section>

      <section className="settings-section">
        <h2>提醒</h2>
        <label className="checkbox-row">
          <input type="checkbox" checked={cfg.reminders.enabled} onChange={(e) => updateReminders({ enabled: e.target.checked })} />
          启用主动提醒
        </label>
        <label>提醒间隔（分钟）
          <input type="number" value={cfg.reminders.minIntervalMinutes} onChange={(e) => updateReminders({ minIntervalMinutes: Number(e.target.value) })} />
        </label>
        <div className="settings-row">
          <label>开始
            <input type="number" min={0} max={23} value={cfg.reminders.startHour} onChange={(e) => updateReminders({ startHour: Number(e.target.value) })} />
          </label>
          <label>结束
            <input type="number" min={0} max={23} value={cfg.reminders.endHour} onChange={(e) => updateReminders({ endHour: Number(e.target.value) })} />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h2>行为与启动</h2>
        <label className="checkbox-row">
          <input type="checkbox" checked={cfg.autostart} onChange={(e) => update({ autostart: e.target.checked })} />
          开机自启
        </label>
        <label>行为模式
          <select value={cfg.behaviorMode} onChange={(e) => update({ behaviorMode: e.target.value as 'rules' | 'llm' })}>
            <option value="rules">规则驱动（使用角色包 corpus.json）</option>
            <option value="llm">LLM 决策（预留）</option>
          </select>
        </label>
      </section>
    </div>
  )
}
