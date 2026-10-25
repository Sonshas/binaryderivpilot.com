import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui'
import { normalizeKenyanPhone } from '@/domain/megapay'
import { localPhoneDisplay } from '@/domain/withdrawals'
import { cn } from '@/lib/cn'
import { authService } from '@/services/auth'

export function MpesaPhoneChoice({
  onChange,
  hint = 'The M-Pesa prompt is sent to this Safaricom number.',
  testId = 'mpesa-phone',
}: {
  onChange: (phone: string) => void
  hint?: string
  testId?: string
}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const picked = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [accountPhone, setAccountPhone] = useState('')
  const [source, setSource] = useState<'account' | 'other'>('account')
  const [other, setOther] = useState('')

  useEffect(() => {
    let cancelled = false
    void authService.getProfileExtras().then((extras) => {
      if (cancelled) return
      const normalized = normalizeKenyanPhone(extras.phone ?? '')
      const local = normalized ? localPhoneDisplay(normalized) : ''
      setAccountPhone(local)
      setLoaded(true)
      if (picked.current) return
      if (local) {
        setSource('account')
        onChangeRef.current(local)
      } else {
        setSource('other')
        onChangeRef.current('')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  function chooseAccount() {
    if (!accountPhone) return
    picked.current = true
    setSource('account')
    onChange(accountPhone)
  }

  function chooseOther() {
    picked.current = true
    setSource('other')
    onChange(other)
  }

  return (
    <fieldset className="grid gap-2" data-testid={testId}>
      <legend className="text-sm font-medium text-paper">M-Pesa phone number</legend>
      <label
        className={cn(
          'flex items-start gap-3 rounded-xl border px-3 py-2.5',
          source === 'account' ? 'border-signal bg-ink' : 'border-line bg-ink-2',
          loaded && !accountPhone ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        <input
          type="radio"
          name={`${testId}-source`}
          className="mt-1"
          checked={source === 'account'}
          disabled={!accountPhone}
          onChange={chooseAccount}
          data-testid={`${testId}-account`}
        />
        <span>
          <span className="block text-sm font-medium text-paper">Phone on this account</span>
          <span className="block text-xs text-mist">
            {!loaded ? 'Loading the number on this account…' : accountPhone || 'No M-Pesa number saved on this account'}
          </span>
        </span>
      </label>
      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5',
          source === 'other' ? 'border-signal bg-ink' : 'border-line bg-ink-2',
        )}
      >
        <input
          type="radio"
          name={`${testId}-source`}
          className="mt-1"
          checked={source === 'other'}
          onChange={chooseOther}
          data-testid={`${testId}-other`}
        />
        <span className="text-sm font-medium text-paper">Different phone number</span>
      </label>
      {source === 'other' ? (
        <Input
          label="Different M-Pesa number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0712345678"
          value={other}
          onChange={(event) => {
            setOther(event.target.value)
            onChange(event.target.value)
          }}
          data-testid={`${testId}-other-input`}
        />
      ) : null}
      <p className="text-xs text-mist">{hint}</p>
    </fieldset>
  )
}
