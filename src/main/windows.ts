import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

let petWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null

function loadRenderer(win: BrowserWindow, windowName: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/?window=${windowName}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: windowName } })
  }
}

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
  loadRenderer(petWindow, 'pet')
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
  loadRenderer(panelWindow, 'panel')
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

export function setPetScale(scale: number): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const size = Math.round(320 * (scale || 1))
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