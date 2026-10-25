import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ProgressLoader } from '@/components/ProgressLoader'
import { Alert, Button, Card, Input } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuth'
import { NO_EMAIL_LINK_MESSAGE } from '@/lib/auth-link'
import { TRADE_ROUTE, resolvePostAuthPath } from '@/lib/auth-redirect'
import { authService, e2eAuthBypassEnabled } from '@/services/auth'
import { normalizeKenyanPhone } from '@/domain/megapay'
import { isValidEmail } from '@/lib/format'
import { parseLoginId } from '@/lib/identity'

const authLink = 'font-semibold text-signal hover:text-signal-light hover:underline'

export const COUNTRIES = [
  'Australia',
  'Canada',
  'Germany',
  'India',
  'Kenya',
  'Nigeria',
  'South Africa',
  'United Kingdom',
  'United States',
  'Other',
]

export function LoginForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!parseLoginId(email)) next.email = 'Enter your email or phone number.'
    if (password.length < 8) next.password = 'Password must be at least 8 characters.'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.signIn({ email, password })
    setMessage(result.message)
    setOk(result.connected && Boolean(result.data))
    setLoading(false)
    if (result.connected && result.data) {
      navigate(resolvePostAuthPath(location.search, location.state), { replace: true })
    }
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Log in</h1>
      <p className="mt-1 text-sm text-mist">Welcome back. Sign in to access your account.</p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
        <Input
          label="Email or phone"
          type="text"
          autoComplete="username"
          placeholder="name@example.com or 0712345678"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setErrors((prev) => ({ ...prev, email: '' }))
            setMessage(null)
          }}
          error={errors.email}
          data-testid="login-id"
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((prev) => ({ ...prev, password: '' }))
            setMessage(null)
          }}
          error={errors.password}
        />
        <div className="text-sm">
          <Link to="/forgot-password" className={authLink}>
            Forgot password
          </Link>
        </div>
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Log in'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-mist">
        New to SmartBaseBinary?{' '}
        <Link to="/register" className={authLink}>
          Create account
        </Link>
      </p>
    </Card>
  )
}

export function SignupForm() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('Kenya')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (name.trim().length < 2) next.name = 'Enter your full name.'
    if (!isValidEmail(email)) next.email = 'Enter a valid email (e.g. name@example.com).'
    if (country === 'Kenya') {
      if (!normalizeKenyanPhone(phone)) {
        next.phone = 'Use a Kenya number like 0712345678 or 0112345678.'
      }
    } else if (phone.trim().length < 6) {
      next.phone = 'Enter a phone number.'
    }
    if (!country.trim()) next.country = 'Select a country.'
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    if (confirm !== password) next.confirm = 'Passwords do not match.'
    if (!accepted) next.terms = 'Accept Terms and Privacy to continue.'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.signUp({ name, email, password, phone, country })
    setLoading(false)
    if (result.connected && result.data) {
      setOk(true)
      setMessage(result.message)
      navigate(TRADE_ROUTE, { replace: true })
      return
    }
    const text = result.message.toLowerCase()
    if (text.includes('email')) {
      setErrors((prev) => ({ ...prev, email: result.message }))
      return
    }
    if (text.includes('phone')) {
      setErrors((prev) => ({ ...prev, phone: result.message }))
      return
    }
    setOk(false)
    setMessage(result.message)
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Create account</h1>
      <p className="mt-1 text-sm text-mist">
        Create an account today to start your trading journey.
      </p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
        <Input
          label="Full name"
          placeholder="Jane Doe"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setErrors((prev) => ({ ...prev, name: '' }))
            setMessage(null)
          }}
          error={errors.name}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setErrors((prev) => ({ ...prev, email: '' }))
            setMessage(null)
          }}
          error={errors.email}
        />
        <Input
          label="Phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="0712345678 or 0112345678"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setErrors((prev) => ({ ...prev, phone: '' }))
            setMessage(null)
          }}
          error={errors.phone}
        />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-paper">Country</span>
          <select
            className="h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-sm text-paper"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value)
              setErrors((prev) => ({ ...prev, country: '', phone: '' }))
              setMessage(null)
            }}
          >
            {COUNTRIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {errors.country ? <span className="text-xs text-put">{errors.country}</span> : null}
        </label>
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((prev) => ({ ...prev, password: '' }))
            setMessage(null)
          }}
          error={errors.password}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            setErrors((prev) => ({ ...prev, confirm: '' }))
            setMessage(null)
          }}
          error={errors.confirm}
        />
        <label className="flex items-start gap-2 text-sm text-mist">
          <input
            type="checkbox"
            className="mt-1"
            checked={accepted}
            onChange={(e) => {
              setAccepted(e.target.checked)
              setErrors((prev) => ({ ...prev, terms: '' }))
              setMessage(null)
            }}
          />
          <span>
            I agree to the{' '}
            <Link to="/disclosure" className={authLink}>
              disclosure
            </Link>
            .
          </span>
        </label>
        {errors.terms ? <p className="text-xs text-put">{errors.terms}</p> : null}
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-mist">
        Already registered?{' '}
        <Link to="/login" className={authLink}>
          Log in
        </Link>
      </p>
    </Card>
  )
}

export function ForgotPasswordForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isValidEmail(email)) {
      setError('Enter a valid email.')
      return
    }
    setError('')
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.requestPasswordReset(email)
    setLoading(false)
    if (e2eAuthBypassEnabled && result.connected) {
      navigate('/reset-password', {
        replace: true,
        state: { recoveryReady: true, email: email.trim().toLowerCase() },
      })
      return
    }
    setMessage(result.message)
    setOk(result.connected)
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Reset password</h1>
      <p className="mt-1 text-sm text-mist">
        {e2eAuthBypassEnabled
          ? 'Enter the email on your account. You can choose a new password on the next step.'
          : 'We will email a reset link. Open it on this site to choose a new password.'}
      </p>
      <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
        <Input
          label="Email"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError('')
            setMessage(null)
          }}
          error={error}
        />
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-mist">
        Remember your password?{' '}
        <Link to="/login" className={authLink}>
          Back to login
        </Link>
      </p>
      <p className="mt-2 text-sm text-mist">
        No account yet?{' '}
        <Link to="/register" className={authLink}>
          Create account
        </Link>
      </p>
    </Card>
  )
}

export function ResetPasswordForm() {
  const location = useLocation()
  const { isSignedIn, loading: sessionLoading } = useAuthSession()
  const recoveryReady =
    Boolean(location.state) &&
    typeof location.state === 'object' &&
    'recoveryReady' in location.state &&
    Boolean((location.state as { recoveryReady?: boolean }).recoveryReady)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'checking' | 'ready' | 'missing' | 'done'>('checking')
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeOk, setNoticeOk] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void authService.consumeEmailLink().then((result) => {
      if (cancelled) return
      if (result.message === NO_EMAIL_LINK_MESSAGE) {
        setPhase(recoveryReady ? 'ready' : 'missing')
        return
      }
      if (!result.connected || !result.data) {
        setNotice(result.message)
        setNoticeOk(false)
        setPhase('missing')
        return
      }
      if (result.data.purpose === 'recovery' || result.data.hasSession) {
        setNotice(null)
        setPhase('ready')
        return
      }
      setNotice(result.message)
      setNoticeOk(true)
      setPhase('missing')
    })
    return () => {
      cancelled = true
    }
  }, [recoveryReady])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setError('')
    setSaving(true)
    setNotice(null)
    const result = await authService.updatePassword(password, 'recovery')
    setNotice(result.message)
    setNoticeOk(result.connected)
    setSaving(false)
    if (result.connected) {
      setPassword('')
      setConfirm('')
      setPhase('done')
    }
  }

  const showForm = phase === 'ready' || (phase === 'missing' && !notice && !sessionLoading && isSignedIn)

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Choose a new password</h1>
      <p className="mt-1 text-sm text-mist">Use at least 8 characters. This replaces the password on your account.</p>
      {phase === 'checking' || (phase === 'missing' && !notice && sessionLoading) ? (
        <ProgressLoader layout="inline" label="Checking your reset link" />
      ) : null}
      {notice ? <Alert tone={noticeOk ? 'signal' : 'warn'} className="mt-5">{notice}</Alert> : null}
      {showForm ? (
        <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
              setNotice(null)
            }}
            error={error || undefined}
          />
          <Input
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value)
              setError('')
              setNotice(null)
            }}
          />
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      ) : null}
      {phase === 'done' ? (
        <div className="mt-5">
          <Link to={TRADE_ROUTE}>
            <Button type="button" className="w-full">
              Continue
            </Button>
          </Link>
        </div>
      ) : null}
      {phase === 'missing' && !showForm ? (
        <div className="mt-5 space-y-3">
          {notice ? null : (
            <p className="text-sm text-mist">This reset link is missing or has expired. Request a new one.</p>
          )}
          <Link to="/forgot-password" className="block">
            <Button type="button" className="w-full">
              Request a new link
            </Button>
          </Link>
        </div>
      ) : null}
      <p className="mt-4 text-sm text-mist">
        Finished with this reset?{' '}
        <Link to="/login" className={authLink}>
          Back to login
        </Link>
      </p>
    </Card>
  )
}

export function ConfirmEmailPanel() {
  const navigate = useNavigate()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    let cancelled = false
    void authService.consumeEmailLink().then((result) => {
      if (cancelled) return
      if (result.data?.purpose === 'recovery') {
        navigate('/reset-password', { replace: true, state: { recoveryReady: true } })
        return
      }
      setChecking(false)
      if (result.message === NO_EMAIL_LINK_MESSAGE) {
        setOk(false)
        setMessage('Open the confirmation link from your email.')
        return
      }
      setMessage(result.message)
      setOk(result.connected)
      setHasSession(Boolean(result.data?.hasSession))
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Confirm email</h1>
      <p className="mt-1 text-sm text-mist">
        This page finishes email confirmation and password recovery links.
      </p>
      {checking ? <ProgressLoader layout="inline" label="Checking your link" /> : null}
      {message ? <Alert tone={ok ? 'signal' : 'warn'} className="mt-5">{message}</Alert> : null}
      {!checking ? (
        <div className="mt-5 space-y-3">
          {ok && hasSession ? (
            <Link to={TRADE_ROUTE} className="block">
              <Button type="button" className="w-full">
                Continue
              </Button>
            </Link>
          ) : (
            <Link to="/login" className="block">
              <Button type="button" className="w-full">
                Log in
              </Button>
            </Link>
          )}
          {!ok ? (
            <p className="text-center text-sm text-mist">
              Still waiting on the email?{' '}
              <Link to="/verify-email" className={authLink}>
                Resend confirmation email
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

export function VerifyEmailPanel() {
  const location = useLocation()
  const stateEmail =
    location.state && typeof location.state === 'object' && 'email' in location.state
      ? String((location.state as { email?: string }).email ?? '')
      : ''
  const [email, setEmail] = useState(stateEmail)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (stateEmail) setEmail(stateEmail)
  }, [stateEmail])

  async function resend() {
    if (!isValidEmail(email)) {
      setOk(false)
      setMessage('Enter a valid email.')
      return
    }
    setLoading(true)
    setOk(false)
    setMessage(null)
    const result = await authService.resendVerification(email)
    setMessage(result.message)
    setOk(result.connected)
    setLoading(false)
  }

  return (
    <Card>
      <h1 className="font-display text-2xl font-semibold">Verify email</h1>
      <p className="mt-1 text-sm text-mist">
        {e2eAuthBypassEnabled
          ? 'Accounts on this site are active as soon as they are created.'
          : 'Confirm the link in your inbox, then log in.'}
      </p>
      <div className="mt-5 space-y-3">
        <Input
          label="Email to verify"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setMessage(null)
          }}
        />
        {message ? <Alert tone={ok ? 'signal' : 'warn'}>{message}</Alert> : null}
        <Button type="button" className="w-full" onClick={() => void resend()} disabled={loading}>
          {loading ? 'Sending…' : 'Resend verification'}
        </Button>
        <p className="text-center text-sm text-mist">
          Already confirmed?{' '}
          <Link to="/login" className={authLink}>
            Return to login
          </Link>
        </p>
      </div>
    </Card>
  )
}
