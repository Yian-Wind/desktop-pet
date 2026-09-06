import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

let petWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null

const PET_BASE_SIZE = 320
const PET_UI_MARGIN_RATIO = 0.58
const PET_UI_MIN_VERTICAL_MARGIN = 300

function loadRenderer(win: BrowserWindow, windowName: string, tab?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const forceSurf =
      process.env['SURF_TEST'] === '1' && windowName === 'pet' ? '&forceSurf=1' : ''
    void win.loadURL(`${devUrl}/?window=${windowName}${tab ? `&tab=${tab}` : ''}${forceSurf}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: {
        window: windowName,
        ...(tab ? { tab } : {}),
        ...(process.env['SURF_TEST'] === '1' && windowName === 'pet' ? { forceSurf: '1' } : {})
      }
    })
  }
}

export function createPetWindow(position: { x: number; y: number; scale: number }): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const stageSize = PET_BASE_SIZE * (position.scale || 1)
  const margins = getPetMarginsForStage(stageSize)
  const windowWidth = Math.round(stageSize + margins.horizontal * 2)
  const windowHeight = Math.round(stageSize + margins.vertical * 2)
  // A persisted position can point off-screen (resolution/monitor changes,
  // stale config); clamp the stage back into the visible work area.
  const maxStageX = Math.max(0, width - stageSize)
  const maxStageY = Math.max(0, height - stageSize)
  const stageX = Math.min(Math.max(position.x || width - stageSize - 40, 0), maxStageX)
  const stageY = Math.min(Math.max(position.y || height - stageSize - 40, 0), maxStageY)
  const win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: stageX - margins.horizontal,
    y: stageY - margins.vertical,
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
  const stageSize = PET_BASE_SIZE * (scale || 1)
  const margins = getPetMarginsForStage(stageSize)
  const windowWidth = Math.round(stageSize + margins.horizontal * 2)
  const windowHeight = Math.round(stageSize + margins.vertical * 2)
  const bounds = petWindow.getBounds()
  const centerStageX = bounds.x + getPetWindowMargins().horizontal + stageSize / 2
  const centerStageY = bounds.y + getPetWindowMargins().vertical + stageSize / 2
  petWindow.setBounds({
    x: Math.round(centerStageX - stageSize / 2 - margins.horizontal),
    y: Math.round(centerStageY - stageSize / 2 - margins.vertical),
    width: windowWidth,
    height: windowHeight
  })
}

export function getPetWindowMargins(): { horizontal: number; vertical: number } {
  if (!petWindow || petWindow.isDestroyed()) return { horizontal: 0, vertical: 0 }
  const bounds = petWindow.getBounds()
  const stageSize = bounds.width / (1 + PET_UI_MARGIN_RATIO * 2)
  return getPetMarginsForStage(stageSize)
}

function getPetMarginsForStage(stageSize: number): { horizontal: number; vertical: number } {
  const horizontal = Math.round(stageSize * PET_UI_MARGIN_RATIO)
  return {
    horizontal,
    vertical: Math.max(PET_UI_MIN_VERTICAL_MARGIN, horizontal)
  }
}

function getPetStageOrigin(): { x: number; y: number } {
  if (!petWindow || petWindow.isDestroyed()) return { x: 0, y: 0 }
  const bounds = petWindow.getBounds()
  const margins = getPetMarginsForStage(bounds.width / (1 + PET_UI_MARGIN_RATIO * 2))
  return { x: bounds.x + margins.horizontal, y: bounds.y + margins.vertical }
}

export function setPetStagePosition(x: number, y: number): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const bounds = petWindow.getBounds()
  const stageSize = bounds.width / (1 + PET_UI_MARGIN_RATIO * 2)
  const margins = getPetMarginsForStage(stageSize)
  const targetX = Math.round(x - margins.horizontal)
  const targetY = Math.round(y - margins.vertical)
  // getBounds() can briefly report NaN mid DPI/scale transitions; a NaN here
  // would crash setPosition with an opaque conversion failure.
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return
  petWindow.setPosition(targetX, targetY)
}

export function getPetStagePosition(): { x: number; y: number } {
  return getPetStageOrigin()
}
