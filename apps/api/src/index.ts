import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { createMarketDataRouter } from './routes/market-data.js'

function loadRepoEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../.env'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      loadEnv({ path })
      return
    }
  }
  loadEnv()
}

loadRepoEnv()

// Local-dev market-data helper only — not deployed to Vultr.
const port = Number(process.env.PORT ?? 3001)
const corsOriginEnv =
  process.env.CORS_ORIGIN ??
  'http://localhost:5173,http://localhost:5174'
const corsOrigins = corsOriginEnv.split(',').map((value) => value.trim()).filter(Boolean)

const app = express()

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin) || corsOrigins.includes('*')) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
  }),
)
app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

app.use('/market-data', createMarketDataRouter())

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})
