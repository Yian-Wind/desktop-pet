const { app, BrowserWindow, screen } = require('electron')
const http = require('node:http')
const { readFileSync, writeFileSync } = require('node:fs')
const { join, normalize, extname } = require('node:path')

const ROOT = 'D:/pet'
const PORT = 8848
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.atlas': 'text/plain; charset=utf-8',
  '.css': 'text/css'
}

const RUNTIMES = {
  '4235': {
    src: 'node_modules/@esotericsoftware/spine-webgl/dist/iife/spine-webgl.js',
    out: 'spine-reference-4.2.png',
    label: '4.2.35'
  },
  '4313': {
    src: 'tools/vendor/spine-4313/node_modules/@esotericsoftware/spine-webgl/dist/iife/spine-webgl.js',
    out: 'spine-reference-4.3.png',
    label: '4.3.13'
  }
}

function renderHtml(runtime) {
  const tpl = readFileSync(join(ROOT, 'tools', 'spine-reference.template.html'), 'utf8')
  return tpl
    .split('{{PORT}}').join(String(PORT))
    .split('{{RUNTIME_SRC}}').join(runtime.src)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT)
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/tools/spine-reference.html'
  const filePath = normalize(join(ROOT, pathname))
  if (!filePath.startsWith(normalize(ROOT))) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  try {
    const body = pathname === '/tools/spine-reference.html'
      ? Buffer.from(renderHtml(RUNTIMES[process.env.REF_RUNTIME || '4235']), 'utf8')
      : readFileSync(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  const runtimeKey = process.env.REF_RUNTIME || '4235'
  const runtime = RUNTIMES[runtimeKey]
  const work = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1000, work.width - 40)
  const height = Math.min(860, work.height - 20)
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false }
  })
  win.webContents.on('console-message', (_e, level, message) => console.log('[page]', level, message))
  await win.loadURL('http://127.0.0.1:' + PORT + '/tools/spine-reference.html')
  await new Promise((r) => setTimeout(r, 7000))
  try {
    const probe = await win.webContents.executeJavaScript(
      'JSON.stringify({ status: document.body.dataset.status, cells: document.querySelectorAll(".cell").length, msg: document.getElementById("status") ? document.getElementById("status").textContent : null })'
    )
    console.log('[capture]', runtime.label, 'probe:', probe)
  } catch (e) {
    console.log('[capture] probe failed:', String(e))
  }
  const image = await win.webContents.capturePage()
  const png = image.toPNG()
  writeFileSync(join(ROOT, runtime.out), png)
  console.log('[capture]', runtime.label, 'saved', runtime.out, png.length, 'bytes')
  app.quit()
})

app.on('window-all-closed', () => app.quit())
