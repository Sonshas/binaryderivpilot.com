import { useEffect, useState, type FormEvent } from 'react'
import { Alert, Button, Card, PageHeader } from '@/components/ui'
import { PAY_MODES } from '@/domain/payments/pay-mode'
import { activePayMode } from '@/lib/pay-mode'
import type { DepositProvider } from '@/domain/daraja'
import {
  platformSettingsService,
  type MegapayAccountPublic,
} from '@/services/platform-settings'

export function AdminPayMode({ embedded = false }: { embedded?: boolean }) {
  const [selected, setSelected] = useState<DepositProvider>(() => activePayMode())
  const [accounts, setAccounts] = useState<MegapayAccountPublic[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingAccounts, setSavingAccounts] = useState(false)

  useEffect(() => {
    void platformSettingsService.load().then((result) => {
      if (!result.ok) return
      setSelected(result.data.payMode)
      setAccounts(result.data.megapayAccounts)
    })
  }, [])

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const result = await platformSettingsService.savePayMode(selected)
    setSaving(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    setSelected(result.data)
    const label = PAY_MODES.find((mode) => mode.id === result.data)?.label ?? result.data
    setMessage(`${label} is the only active deposit method.`)
  }

  async function toggleAccount(id: 'winsoft' | 'vast', enabled: boolean) {
    setSavingAccounts(true)
    setMessage(null)
    const result = await platformSettingsService.saveMegapayAccounts({ [id]: enabled })
    setSavingAccounts(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    setAccounts(result.data.accounts)
    setMessage(result.data.message)
  }

  const form = (
    <form className="space-y-4" onSubmit={onSave} data-testid="admin-pay-mode">
      {message ? <Alert tone="signal">{message}</Alert> : null}
      {embedded ? (
        <div>
          <p className="font-semibold text-paper">Deposit pay mode</p>
          <p className="text-sm text-mist">
            One method at a time for every member. Daraja and MegaPay keys stay in .env.
          </p>
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {PAY_MODES.map((mode) => {
          const on = selected === mode.id
          return (
            <label key={mode.id} className="block cursor-pointer">
              <Card className={`space-y-2 ${on ? 'ring-1 ring-signal' : ''}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-paper">
                  <input
                    type="radio"
                    name="paymode"
                    checked={on}
                    onChange={() => setSelected(mode.id)}
                    data-testid={`paymode-${mode.id}`}
                  />
                  {mode.label}
                  {on ? <span className="text-xs font-semibold uppercase text-signal">Active</span> : null}
                </span>
                <p className="text-sm text-mist">{mode.detail}</p>
                <p className="text-xs text-mist">Env keys: {mode.envKeys.join(', ')}</p>
              </Card>
            </label>
          )
        })}
      </div>
      <Button type="submit" disabled={saving} data-testid="paymode-save">
        Save pay mode
      </Button>

      {selected === 'megapay' || accounts.some((a) => a.configured) ? (
        <div className="space-y-3 border-t border-line pt-4" data-testid="megapay-accounts">
          <div>
            <p className="font-semibold text-paper">MegaPay accounts</p>
            <p className="text-sm text-mist">
              Enable Winsoft and/or Vast. When both are on, STK alternates between them.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.map((acct) => (
              <Card key={acct.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-paper">{acct.label}</span>
                  <label className="flex items-center gap-2 text-sm text-mist">
                    <input
                      type="checkbox"
                      checked={acct.enabled}
                      disabled={!acct.configured || savingAccounts}
                      onChange={(e) => void toggleAccount(acct.id, e.target.checked)}
                      data-testid={`megapay-${acct.id}-enabled`}
                    />
                    Enabled
                  </label>
                </div>
                {acct.configured ? (
                  <p className="text-xs text-mist">
                    {acct.emailHint} · key {acct.keyHint}
                  </p>
                ) : (
                  <p className="text-xs text-amber">Not in edge secrets yet</p>
                )}
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </form>
  )

  if (embedded) return <Card className="space-y-4">{form}</Card>

  return (
    <div>
      <PageHeader
        title="Pay mode"
        subtitle="Deposits use one method at a time for every member. Daraja and MegaPay keys stay in .env."
      />
      {form}
    </div>
  )
}
