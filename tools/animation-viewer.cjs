/** Spine 动画全库预览的本地静态服务器（零依赖）。

  node tools/animation-viewer.cjs            # 默认 127.0.0.1:8137
  node tools/animation-viewer.cjs 8200       # 指定端口

路由：
  /                       → tools/animation-viewer.html
  /runtime/spine-webgl.js → node_modules 官方 4.2 iife 运行时
  /packs/<pack>/<file>    → packs/<pack>/<file>（白名单目录，防穿越）
*/
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.argv[2]) || 8137
const RUNTIME = path.join(ROOT, 'node_modules', '@esotericsoftware', 'spine-webgl', 'dist', 'iife', 'spine-webgl.js')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json'
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname
  try {
    if (p === '/' || p === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'tools', 'animation-viewer.html')), MIME['.html'])
    }
    if (p === '/runtime/spine-webgl.js') {
      return send(res, 200, fs.readFileSync(RUNTIME), MIME['.js'])
    }
    if (p.startsWith('/packs/')) {
      const rel = path.normalize(decodeURIComponent(p.slice('/packs/'.length)))
      const abs = path.join(ROOT, 'packs', rel)
      if (!abs.startsWith(path.join(ROOT, 'packs')) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return send(res, 404, 'not found', 'text/plain')
      }
      return send(res, 200, fs.readFileSync(abs), MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream')
    }
    if (p === '/favicon.ico') { res.writeHead(204); return res.end() }
    send(res, 404, 'not found', 'text/plain')
  } catch (err) {
    send(res, 500, String(err), 'text/plain')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`animation viewer: http://127.0.0.1:${PORT}/`)
})
