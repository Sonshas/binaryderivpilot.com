import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button } from '@/components/ui'
import { notifyDemoSession } from '@/lib/demo-session'
import { pushDemoNotification, updateStoredDemoState } from '@/lib/demo-store'
import { submitKyc, type KycRecord } from '@/lib/kyc'

const STEPS = [
  { title: 'Front of ID', hint: 'Take a clear photo of the front. The name and photo on the card should be readable.' },
  { title: 'Back of ID', hint: 'Take a clear photo of the back of the same ID.' },
  { title: 'Holding your ID', hint: 'Take a photo of yourself holding the ID next to your face.' },
] as const

function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that photo.'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Could not read that photo.'))
      image.onload = () => {
        const max = 960
        const scale = Math.min(1, max / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not read that photo.'))
          return
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function PhotoSlot({
  label,
  photo,
  capture,
  onPick,
}: {
  label: string
  photo: string
  capture: 'environment' | 'user'
  onPick: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex min-h-40 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-ink-2 text-sm text-mist"
        data-testid={`kyc-photo-${label}`}
      >
        {photo ? (
          <img src={photo} alt={label} className="max-h-52 w-full object-contain" />
        ) : (
          <span>Choose {label} photo</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={capture}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onPick(file)
        }}
      />
    </div>
  )
}

export function KycModal({
  email,
  open,
  onClose,
  onSubmitted,
}: {
  email: string
  open: boolean
  onClose: () => void
  onSubmitted: (record: KycRecord) => void
}) {
  const [step, setStep] = useState(0)
  const [idFront, setIdFront] = useState('')
  const [idBack, setIdBack] = useState('')
  const [idHolding, setIdHolding] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const photos = [idFront, idBack, idHolding]
  const current = STEPS[step]!

  function goNext() {
    if (!photos[step]) {
      setError(`Add the ${current.title.toLowerCase()} photo.`)
      return
    }
    setError('')
    setStep((value) => Math.min(value + 1, STEPS.length - 1))
  }

  async function pick(file: File, setPhoto: (value: string) => void) {
    if (!file.type.startsWith('image/')) {
      setError('Choose a photo.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setPhoto(await readPhoto(file))
    } catch (caught) {
      setError('Could not read that photo.')
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!idFront || !idBack || !idHolding) {
      setError('Add the front, the back, and a photo of you holding the ID.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const next = await submitKyc({ email, idFront, idBack, idHolding })
      updateStoredDemoState(email, (state) =>
        pushDemoNotification(state, 'security', 'Verification submitted', 'Your ID photos were submitted for this withdrawal.'),
      )
      notifyDemoSession()
      onSubmitted(next)
    } catch {
      setError('Could not save the photos.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close verification" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="kyc-modal-title"
        data-testid="kyc-modal"
        onSubmit={onSubmit}
        className="relative z-10 max-h-[92svh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-mist">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 id="kyc-modal-title" className="font-display text-lg font-bold text-paper">
              {current.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-mist hover:text-paper" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-mist">
          Your withdrawal was requested successfully and will be processed shortly. {current.hint}
        </p>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {STEPS.map((item, index) => (
            <span key={item.title} className={index <= step ? 'h-1 flex-1 rounded-full bg-signal' : 'h-1 flex-1 rounded-full bg-line'} />
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          {step === 0 ? <PhotoSlot label="front" capture="environment" photo={idFront} onPick={(file) => void pick(file, setIdFront)} /> : null}
          {step === 1 ? <PhotoSlot label="back" capture="environment" photo={idBack} onPick={(file) => void pick(file, setIdBack)} /> : null}
          {step === 2 ? <PhotoSlot label="holding" capture="user" photo={idHolding} onPick={(file) => void pick(file, setIdHolding)} /> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        <div className="mt-4 flex gap-2">
          {step > 0 ? (
            <Button type="button" variant="secondary" onClick={() => { setError(''); setStep((value) => value - 1) }}>
              Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button type="button" className="flex-1" disabled={busy} onClick={goNext} data-testid="kyc-next">
              {busy ? 'Reading photo…' : 'Next'}
            </Button>
          ) : (
            <Button type="submit" className="flex-1" disabled={busy} data-testid="kyc-submit">
              Submit photos
            </Button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  )
}
