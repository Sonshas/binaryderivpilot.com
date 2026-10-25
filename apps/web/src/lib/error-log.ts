export interface ErrorLogEntry {
  id: string
  at: string
  area: string
  operation: string
  message: string
  stack: string | null
  route: string | null
  code: string | null
}

const STORAGE_KEY = 'sbb.a.log'
const MAX_ENTRIES = 200
const listeners = new Set<() => void>()
const recent = new Map<string, number>()
let memory: ErrorLogEntry[] | null = null

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function load(): ErrorLogEntry[] {
  if (memory) return memory
  memory = []
  if (!canUseStorage()) return memory
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return memory
    const parsed = JSON.parse(raw) as ErrorLogEntry[]
    if (Array.isArray(parsed)) memory = parsed.filter((item) => item && typeof item.message === 'string')
  } catch {
    memory = []
  }
  return memory
}

function syncFile(entries: ErrorLogEntry[]): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  void fetch('/__a-log', {
    method: 'PUT',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: formatErrorLog(entries),
  }).catch(() => undefined)
}

function save(entries: ErrorLogEntry[]): void {
  memory = entries
  if (canUseStorage()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    } catch {
      memory = entries.slice(0, 50)
    }
  }
  listeners.forEach((listener) => listener())
  syncFile(memory)
}

export function readErrorLog(): ErrorLogEntry[] {
  return load()
}

export function subscribeErrorLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function recordAppError(input: {
  area: string
  operation: string
  message: string
  stack?: string | null
  code?: string | null
}): void {
  const message = input.message.replace(/\s+/g, ' ').trim().slice(0, 2000)
  if (!message) return
  const fingerprint = `${input.code ?? ''}:${message}`
  const now = Date.now()
  if ((recent.get(fingerprint) ?? 0) > now - 2000) return
  recent.set(fingerprint, now)
  const entry: ErrorLogEntry = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date(now).toISOString(),
    area: input.area.slice(0, 80),
    operation: input.operation.slice(0, 120),
    message,
    stack: input.stack ? input.stack.slice(0, 4000) : null,
    route: typeof window === 'undefined' ? null : window.location.pathname,
    code: input.code ?? null,
  }
  save([entry, ...load()].slice(0, MAX_ENTRIES))
}

export function clearErrorLog(): void {
  recent.clear()
  save([])
}

export function removeErrorLogEntry(id: string): void {
  save(load().filter((entry) => entry.id !== id))
}

export function formatErrorEntry(entry: ErrorLogEntry): string {
  const code = entry.code ? ` (${entry.code})` : ''
  const route = entry.route ? ` ${entry.route}` : ''
  const stack = entry.stack ? `\n${entry.stack}` : ''
  return `${entry.at} [${entry.area}] ${entry.operation}${code}${route}\n${entry.message}${stack}`
}

export function formatErrorLog(entries: ErrorLogEntry[] = readErrorLog()): string {
  if (entries.length === 0) return ''
  return `${entries.map(formatErrorEntry).join('\n---\n')}\n`
}

type Escalate = (input: {
  area: string
  operation: string
  message: string
  stack?: string | null
  code?: string | null
}) => void

let escalate: Escalate | null = null

/** Wire remote/system logging (avoids circular imports with services). */
export function setErrorLogEscalator(fn: Escalate | null): void {
  escalate = fn
}

/** Browser-extension / Deriv reconnect / opaque feed noise — do not store or escalate. */
export function isIgnorableWindowNoise(message: string): boolean {
  return /window\.ethereum|selectedAddress|metamask|failed to connect to metamask|resizeobserver loop|script error\.?$|deriv websocket (closed|error)|deriv websocket not (connected|open)|deriv connection timeout|deriv unavailable|live price is unavailable|request idle timeout/i.test(
    message,
  )
}

function capture(input: {
  area: string
  operation: string
  message: string
  stack?: string | null
  code?: string | null
}): void {
  if (isIgnorableWindowNoise(input.message)) return
  recordAppError(input)
  try {
    escalate?.(input)
  } catch {
    /* never throw from the logger */
  }
}

export function installErrorLog(): void {
  if (typeof window === 'undefined') return
  if (Reflect.get(window, '__sbbErrorLog') === true) return
  Reflect.set(window, '__sbbErrorLog', true)
  window.addEventListener('error', (event) => {
    const error = event.error
    const message = error instanceof Error ? error.message : event.message || 'Script error'
    // Cross-origin scripts (e.g. market WS helpers) often report opaque "Script error." — skip noise.
    if (!error && /^Script error\.?$/i.test(message)) return
    if (isIgnorableWindowNoise(message)) return
    capture({
      area: 'window',
      operation: 'error',
      message,
      stack: error instanceof Error ? error.stack ?? null : null,
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled rejection'
    if (isIgnorableWindowNoise(message)) return
    capture({
      area: 'window',
      operation: 'unhandledrejection',
      message,
      stack: reason instanceof Error ? reason.stack ?? null : null,
    })
  })
  const original = console.error.bind(console)
  void fetch('/__a-log')
    .then((response) => (response.ok ? response.text() : ''))
    .then((text) => {
      for (const block of text.split('\n---\n')) {
        if (!block.includes('[vite] compile')) continue
        const message = block.split('\n').slice(1).join('\n').trim()
        if (!message) continue
        if (readErrorLog().some((entry) => entry.area === 'vite' && entry.message === message)) continue
        capture({ area: 'vite', operation: 'compile', message })
      }
    })
    .catch(() => undefined)
  console.error = (...args: unknown[]) => {
    original(...args)
    const error = args.find((part): part is Error => part instanceof Error)
    const message = args
      .map((part) => (part instanceof Error ? part.message : typeof part === 'string' ? part : ''))
      .filter(Boolean)
      .join(' ')
    if (!message || message.includes('Download the React DevTools')) return
    capture({
      area: 'console',
      operation: 'error',
      message,
      stack: error?.stack ?? null,
    })
  }
}
