import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, join, normalize } from 'path'

const PORT = Number(process.env.PORT) || 8080
const ROOT = process.cwd()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  if (clean.includes('..')) return null
  const rel = clean === '/' ? '/index.html' : clean
  const full = normalize(join(ROOT, 'dist', rel))
  if (!full.startsWith(join(ROOT, 'dist'))) return null
  return full
}

const server = createServer(async (req, res) => {
  try {
    const path = safePath(req.url || '/')
    if (!path) {
      res.writeHead(400)
      res.end('Bad request')
      return
    }
    let data
    try {
      data = await readFile(path)
    } catch {
      // SPA fallback
      try {
        data = await readFile(join(ROOT, 'dist', 'index.html'))
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(data)
        return
      } catch {
        res.writeHead(404)
        res.end('Not found')
        return
      }
    }
    const ext = extname(path)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  } catch (e) {
    res.writeHead(500)
    res.end('Server error')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Spendwise serving dist/ at http://0.0.0.0:${PORT}`)
})
