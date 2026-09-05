// 冲浪下板校准 harness：加载 tools/surf-calibrate.html，等待渲染完成后整页截图
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const { readFileSync, writeFileSync } = require('node:fs')
const { join, normalize, extname } = require('node:path')

const ROOT = 'D:/pet'
const PORT = 8849
const OUT = process.env.CAL_OUT || 'tools/surf-calibrate.png'
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.atlas': 'text/plain; charset=utf-8'
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT)
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/tools/surf-calibrate.html') {
    const tpl = readFileSync(join(ROOT, 'tools/surf-calibrate.html'), 'utf8')
      .split('{{PORT}}').join(String(PORT))
    res.writeHead(200, { 'Content-Type': MIME['.html'] })
    res.end(tpl)
    return
  }
  const filePath = normalize(join(ROOT, pathname))
  if (!filePath.startsWith(normalize(ROOT))) { res.writeHead(403); res.end('forbidden'); return }
  try {
    const body = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('not found')
  }
})

async function main() {
  await app.whenReady()
  const page = new BrowserWindow({
    width: 820,
    height: 1200,
    show: false,
    webPreferences: { offscreen: true }
  })
  const query = process.env.CAL_QUERY ? '?' + process.env.CAL_QUERY : ''
  await page.loadURL(`http://127.0.0.1:${PORT}/tools/surf-calibrate.html${query}`)
  // 等待渲染完成
  await page.webContents.executeJavaScript(
    `new Promise((resolve, reject) => { const t0 = Date.now(); const check = () => { ` +
    `if (document.title === 'done') resolve('ok'); ` +
    `else if (document.title === 'error') reject(new Error(document.getElementById('status').textContent)); ` +
    `else if (Date.now() - t0 > 30000) reject(new Error('timeout')); else setTimeout(check, 100) }; check() })`
  )
  const status = await page.webContents.executeJavaScript(`document.getElementById('status').textContent`)
  console.log('=== status ===')
  console.log(status)
  const frames = await page.webContents.executeJavaScript(`window.__frames || []`)
  const base = join(ROOT, OUT).replace(/\.png$/, '')
  for (const [i, f] of frames.entries()) {
    const file = `${base}-${String(i).padStart(2, '0')}-${String(f.t).replace(/\./g, '_')}.png`
    writeFileSync(file, Buffer.from(f.png.split(',')[1], 'base64'))
    console.log('saved', file)
  }
  app.quit()
}

server.listen(PORT, () => {
  main().catch((e) => { console.error(e); app.quit(1) })
})
