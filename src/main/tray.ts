import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { openPanel } from './windows'

let tray: Tray | null = null

export function createTray(onQuit: () => void): void {
  const icon = nativeImage.createFromPath(join(process.cwd(), 'resources', 'icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('Desktop Pet')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开面板', click: () => openPanel() },
    { type: 'separator' },
    { label: '退出', click: onQuit }
  ]))
}
