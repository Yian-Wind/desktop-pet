import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

let petWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null

const PET_BASE_SIZE = 320
const PET_UI_MARGIN_RATIO = 0.5
const PET_WINDOW_SCALE = 1 + PET_UI_MARGIN_RATIO * 2

function loadRenderer(win: BrowserWindow, windowName: string, tab?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/?window=${windowName}${tab ? `&tab=${tab}` : ''}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: windowName, ...(tab ? { tab } : {}) }
    })
  }
}

export function createPetWindow(position: { x: number; y: number; scale: number }): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const stageSize = PET_BASE_SIZE * (position.scale || 1)
  const size = Math.round(stageSize * PET_WINDOW_SCALE)
  const margin = getPetWindowMargin(size)
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: (position.x || width - stageSize - 40) - margin,
    y: (position.y || height - stageSize - 40) - margin,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('closed', () => {
    if (petWindow === win) petWindow = null
  })
  petWindow = win
  loadRenderer(win, 'pet')
  return win
}

export function createPanelWindow(tab?: 'chat' | 'todos' | 'settings'): BrowserWindow {
  const win = new BrowserWindow({
    width: 860,
    height: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('closed', () => {
    if (panelWindow === win) panelWindow = null
  })
  panelWindow = win
  loadRenderer(win, 'panel', tab)
  return win
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow
}

export function openPanel(tab?: 'chat' | 'todos' | 'settings'): void {
  if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow(tab)
  else if (tab) sendToPanel('panel:tab-changed', tab)
  panelWindow?.show()
  panelWindow?.focus()
}

export function sendToPet(channel: string, payload: unknown): void {
  if (!petWindow || petWindow.isDestroyed() || petWindow.webContents.isDestroyed()) return
  petWindow?.webContents.send(channel, payload)
}

export function sendToPanel(channel: string, payload: unknown): void {
  if (!panelWindow || panelWindow.isDestroyed() || panelWindow.webContents.isDestroyed()) return
  panelWindow?.webContents.send(channel, payload)
}

export function setPetScale(scale: number): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const size = Math.round(PET_BASE_SIZE * (scale || 1) * PET_WINDOW_SCALE)
  const bounds = petWindow.getBounds()
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  petWindow.setBounds({
    x: Math.round(centerX - size / 2),
    y: Math.round(centerY - size / 2),
    width: size,
    height: size
  })
}

export function getPetWindowMargin(windowSize: number): number {
  return Math.round(windowSize * (PET_UI_MARGIN_RATIO / PET_WINDOW_SCALE))
}

function getPetStageOrigin(): { x: number; y: number } {
  if (!petWindow || petWindow.isDestroyed()) return { x: 0, y: 0 }
  const bounds = petWindow.getBounds()
  const margin = getPetWindowMargin(bounds.width)
  return { x: bounds.x + margin, y: bounds.y + margin }
}

export function setPetStagePosition(x: number, y: number): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const bounds = petWindow.getBounds()
  const margin = getPetWindowMargin(bounds.width)
  petWindow.setPosition(Math.round(x - margin), Math.round(y - margin))
}

export function getPetStagePosition(): { x: number; y: number } {
  return getPetStageOrigin()
}
