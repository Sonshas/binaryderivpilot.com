import { getSupabase } from '@/lib/supabase'
import {
  readTradeSettings,
  saveTradeSettings,
  type TradeSettings,
} from '@/lib/trade-settings'
import { reportBackendIssue } from '@/services/system-issues'

const FUNCTION = 'admin-trade-settings'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string }
      if (body.error || body.message) return String(body.error ?? body.message)
    } catch {
      /* ignore */
    }
  }
  return 'Could not save trade settings.'
}

export const adminTradeSettingsService = {
  async load(): Promise<Result<TradeSettings>> {
    const client = getSupabase()
    if (client) {
      const { data, error } = await client.functions.invoke<{ settings?: TradeSettings }>(FUNCTION, { method: 'GET' })
      const status = (error as { context?: Response } | null)?.context?.status
      if (status === 401 || status === 403) return { ok: false, error: await functionError(error) }
      if (!error && data?.settings) {
        return { ok: true, data: saveTradeSettings(data.settings) }
      }
      if (error) reportBackendIssue('admin', 'admin-trade-settings.load', error, status)
    }
    return { ok: true, data: readTradeSettings() }
  },

  async save(input: TradeSettings): Promise<Result<TradeSettings & { message: string }>> {
    const local = saveTradeSettings(input)
    const client = getSupabase()
    if (client) {
      const { data, error } = await client.functions.invoke<{ settings?: TradeSettings; message?: string }>(FUNCTION, {
        method: 'POST',
        body: local,
      })
      const status = (error as { context?: Response } | null)?.context?.status
      if (status === 401 || status === 403) return { ok: false, error: await functionError(error) }
      if (!error && data?.settings) {
        const saved = saveTradeSettings(data.settings)
        return {
          ok: true,
          data: { ...saved, message: typeof data.message === 'string' ? data.message : 'Trade settings saved.' },
        }
      }
      if (error) reportBackendIssue('admin', 'admin-trade-settings.save', error, status)
    }
    return { ok: true, data: { ...local, message: 'Trade settings saved for this browser.' } }
  },
}
