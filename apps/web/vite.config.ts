import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

function rememberCompileError(file: string, message: string): void {
  const text = message.replace(/\s+/g, ' ').trim().slice(0, 2000)
  if (!text) return
  const block = `${new Date().toISOString()} [vite] compile\n${text}\n---\n`
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (prev.includes(text)) return
  writeFileSync(file, (block + prev).slice(0, 1_000_000))
}

function errorLogFile(): Plugin {
  const file = fileURLToPath(new URL('./a.log', import.meta.url))
  return {
    name: 'a-log',
    configureServer(server) {
      // Drop stale compile failures from prior sessions so /__a-log does not
      // keep replaying fixed PARSE_ERRORs into the browser error bridge.
      writeFileSync(file, '')
      const logError = server.config.logger.error.bind(server.config.logger)
      server.config.logger.error = (msg, options) => {
        const raw = typeof msg === 'string' ? msg : ''
        if (raw) rememberCompileError(file, raw)
        logError(msg, options)
      }
      server.middlewares.use('/__a-log', (req, res, next) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end(existsSync(file) ? readFileSync(file, 'utf8') : '')
          return
        }
        if (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE') {
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer | string) => {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          })
          req.on('end', () => {
            const text = req.method === 'DELETE' ? '' : Buffer.concat(chunks).toString('utf8')
            if (text.length > 1_000_000) {
              res.statusCode = 413
              res.end('too large')
              return
            }
            writeFileSync(file, text)
            res.end('ok')
          })
          return
        }
        next()
      })
    },
  }
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => ({
  envDir: repoRoot,
  // Production builds must never bake in the local Playwright bypass.
  ...(mode === 'production'
    ? { define: { 'import.meta.env.VITE_E2E_AUTH_BYPASS': JSON.stringify('false') } }
    : {}),
  plugins: [react(), tailwindcss(), errorLogFile()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: { overlay: false },
  },
}))
