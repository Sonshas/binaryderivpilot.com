import { useState, useSyncExternalStore } from 'react'
import { Button, Card, EmptyState, PageHeader } from '@/components/ui'
import {
  clearErrorLog,
  formatErrorEntry,
  formatErrorLog,
  readErrorLog,
  subscribeErrorLog,
  type ErrorLogEntry,
} from '@/lib/error-log'

function useErrorLog(): ErrorLogEntry[] {
  return useSyncExternalStore(subscribeErrorLog, readErrorLog, readErrorLog)
}

function selectEntry(id: string) {
  const node = document.getElementById(`error-log-${id}`)
  if (!node) return
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {

  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.focus()
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

const VISIBLE_CAP = 40

/** Browser-local runtime errors (this device only). Embedded on System health. */
export function ErrorLogPanel({ embedded = false }: { embedded?: boolean }) {
  const entries = useErrorLog()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyError, setCopyError] = useState('')
  const [expandedStacks, setExpandedStacks] = useState<Record<string, boolean>>({})
  const visible = entries.slice(0, VISIBLE_CAP)
  const hidden = Math.max(0, entries.length - visible.length)

  async function copy(id: string, text: string) {
    setCopyError('')
    const ok = await copyText(text)
    if (!ok) {
      setCopyError('The error text is selected. Press Ctrl+C to copy it.')
      window.setTimeout(() => selectEntry(id), 0)
      return
    }
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={entries.length === 0}
        onClick={() => void copy('all', formatErrorLog(entries))}
      >
        {copiedId === 'all' ? 'Copied' : 'Copy all'}
      </Button>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={entries.length === 0}
        onClick={() => {
          setCopyError('')
          setCopiedId(null)
          setExpandedStacks({})
          clearErrorLog()
        }}
      >
        Clear
      </Button>
    </div>
  )

  const body = (
    <>
      {copyError ? <p className="mb-3 text-sm text-danger">{copyError}</p> : null}
      {entries.length === 0 ? (
        <EmptyState
          title="No errors logged"
          body="Thrown errors, failed requests, and console errors from this browser appear here."
        />
      ) : (
        <div className="grid gap-3">
          {visible.map((entry) => (
            <Card key={entry.id} className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0" id={`error-log-${entry.id}`}>
                  <p className="font-mono text-xs text-mist">
                    {entry.at} · {entry.area} · {entry.operation}
                    {entry.code ? ` · ${entry.code}` : ''}
                    {entry.route ? ` · ${entry.route}` : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-paper">{entry.message}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void copy(entry.id, formatErrorEntry(entry))}
                >
                  {copiedId === entry.id ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {entry.stack ? (
                expandedStacks[entry.id] ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-3 font-mono text-[11px] text-mist">
                    {entry.stack}
                  </pre>
                ) : (
                  <button
                    type="button"
                    className="text-left text-xs text-signal hover:text-paper"
                    onClick={() => setExpandedStacks((current) => ({ ...current, [entry.id]: true }))}
                  >
                    Show stack
                  </button>
                )
              ) : null}
            </Card>
          ))}
          {hidden > 0 ? (
            <p className="text-xs text-mist">
              Showing latest {visible.length} of {entries.length}. Copy all or clear to manage the rest.
            </p>
          ) : null}
        </div>
      )}
    </>
  )

  if (embedded) {
    return (
      <Card className="mt-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display font-semibold">This browser’s error log</h2>
            <p className="mt-0.5 text-xs text-mist">
              Local only — not shared with other admins. Server issues are listed above.
            </p>
          </div>
          {actions}
        </div>
        {body}
      </Card>
    )
  }

  return (
    <div>
      <PageHeader
        title="Error log"
        subtitle="Runtime errors from this browser. The same text is written to a.log in the web app folder."
        actions={actions}
      />
      {body}
    </div>
  )
}

export function ErrorLogPage() {
  return <ErrorLogPanel />
}
