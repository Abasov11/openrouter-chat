import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

/** Serves the built client from `root`; unknown paths get index.html (single page app). */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  let file = normalize(join(root, pathname))
  if (!file.startsWith(root + sep)) file = join(root, 'index.html') // path traversal → just the app
  let body: Buffer
  try {
    body = await readFile(file)
  } catch {
    file = join(root, 'index.html')
    body = await readFile(file)
  }
  const hashed = file.includes(`${sep}assets${sep}`) // Vite fingerprints these
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(body)
}
