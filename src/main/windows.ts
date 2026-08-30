import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

let petWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null

export function createPetWindow(position: { x: number; y: number; scale: number }): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const size = 320 * (position.scale || 1)
  petWindow = new BrowserWindow({
    width: size,
    height: size,
    x: position.x || width - size - 40,
    y: position.y || height - size - 40,
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
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  petWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'pet' } })
  return petWindow
}

export function createPanelWindow(): BrowserWindow {
  panelWindow = new BrowserWindow({
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
  panelWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'panel' } })
  return panelWindow
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow
}

export function openPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) createPanelWindow()
  panelWindow?.show()
  panelWindow?.focus()
}

export function sendToPet(channel: string, payload: unknown): void {
  petWindow?.webContents.send(channel, payload)
}

export function sendToPanel(channel: string, payload: unknown): void {
  panelWindow?.webContents.send(channel, payload)
}
