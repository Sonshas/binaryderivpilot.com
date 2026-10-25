import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Input, PageHeader } from '@/components/ui'
import { COUNTRIES } from '@/features/auth/AuthForms'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useAuthSession } from '@/hooks/useAuth'
import { accountDisplayName } from '@/lib/branding'
import { safeUserMessage } from '@/lib/safe-user-message'
import { authService } from '@/services/auth'

export function ProfilePage() {
  const { user, isSignedIn } = useAuthSession()
  const { kind } = useAccountMode()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordOk, setPasswordOk] = useState(false)

  useEffect(() => {
    if (!isSignedIn) {
      setLoaded(false)
      return
    }
    let cancelled = false
    setLoaded(false)
    void authService.getProfileExtras().then((next) => {
      if (cancelled) return
      setName(next.displayName ?? user?.name ?? '')
      setEmail(user?.email ?? '')
      setPhone(next.phone ?? '')
      setCountry(next.country ?? '')
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [isSignedIn, user?.id, user?.email, user?.name])

  const countryOptions = country && !COUNTRIES.includes(country) ? [country, ...COUNTRIES] : COUNTRIES

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const result = await authService.updateProfile({ name, email, phone, country })
    setSaved(result.connected)
    setMessage(safeUserMessage(result.message, 'Could not update your profile. Please try again.'))
    setBusy(false)
  }

  async function onPassword(event: FormEvent) {
    event.preventDefault()
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setPasswordError('Passwords do not match.')
      return
    }
    setPasswordError('')
    setPasswordBusy(true)
    setPasswordOk(false)
    const result = await authService.updatePassword(password)
    setPasswordMessage(safeUserMessage(result.message, 'Could not update your password. Please try again.'))
    setPasswordOk(result.connected)
    setPasswordBusy(false)
    if (result.connected) {
      setPassword('')
      setConfirm('')
    }
  }

  async function logout() {
    setSigningOut(true)
    const result = await authService.signOut()
    setSaved(result.connected)
    setMessage(safeUserMessage(result.message, 'Signed out.'))
    setSigningOut(false)
    navigate('/login', { replace: true })
  }

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your name, email, and phone are stored on your account. Email and phone must be unique." />
      <Card className="max-w-xl">
        {isSignedIn ? (
          <form className="space-y-3" onSubmit={(event) => void onSave(event)} noValidate>
            <Input
              label="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              data-testid="profile-name"
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              hint="This is the address you use to sign in."
              data-testid="profile-email"
            />
            <Input
              label="Phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              hint="Each phone number can belong to only one account."
              data-testid="profile-phone"
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-paper">Country</span>
              <select
                className="h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-sm text-paper"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                data-testid="profile-country"
              >
                <option value="">Select a country</option>
                {countryOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <Input label="Active account" value={accountDisplayName(kind)} readOnly data-testid="profile-mode" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !loaded} data-testid="profile-save">
                {busy ? 'Saving…' : 'Save profile'}
              </Button>
              <Button type="button" variant="secondary" disabled={signingOut} onClick={() => void logout()}>
                {signingOut ? 'Signing out…' : 'Log out'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Link to="/login">
              <Button type="button">Log in</Button>
            </Link>
            <Link to="/register">
              <Button type="button" variant="secondary">
                Create account
              </Button>
            </Link>
          </div>
        )}
        {message ? <Alert tone={saved ? 'signal' : 'warn'}>{message}</Alert> : null}
      </Card>
      {isSignedIn ? (
        <Card className="mt-4 max-w-xl">
          <h2 className="font-display font-semibold">Password</h2>
          <form className="mt-3 space-y-3" onSubmit={(event) => void onPassword(event)} noValidate>
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordError('')
                setPasswordMessage(null)
              }}
              error={passwordError || undefined}
              data-testid="profile-password"
            />
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
                setPasswordError('')
                setPasswordMessage(null)
              }}
              data-testid="profile-password-confirm"
            />
            {passwordMessage ? <Alert tone={passwordOk ? 'signal' : 'warn'}>{passwordMessage}</Alert> : null}
            <Button type="submit" disabled={passwordBusy} data-testid="profile-password-save">
              {passwordBusy ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  )
}
