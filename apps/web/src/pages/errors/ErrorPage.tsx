import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { APP_NAME } from '@/lib/constants'

export type ErrorKind = '400' | '401' | '403' | '404' | '408' | '429' | '500' | '502' | '503' | '504' | 'offline'

type Copy = {
  code: string
  title: string
  body: string
  primary: string
}

const COPY: Record<ErrorKind, Copy> = {
  '400': {
    code: '400',
    title: 'That request could not be read',
    body: 'Check the address and try again.',
    primary: 'Return home',
  },
  '401': {
    code: '401',
    title: 'Sign in to open this page',
    body: 'Sign in to continue.',
    primary: 'Log in',
  },
  '403': {
    code: '403',
    title: 'This account cannot open that page',
    body: 'You do not have access to this page.',
    primary: 'Return home',
  },
  '404': {
    code: '404',
    title: 'That address is not on this site',
    body: 'Check the address, or return home.',
    primary: 'Return home',
  },
  '408': {
    code: '408',
    title: 'The request took too long',
    body: 'This took too long. Try again.',
    primary: 'Try again',
  },
  '429': {
    code: '429',
    title: 'Too many requests were sent',
    body: 'Wait a moment, then try again.',
    primary: 'Return home',
  },
  '500': {
    code: '500',
    title: 'This page failed to load',
    body: 'Reload the page and try again.',
    primary: 'Reload',
  },
  '502': {
    code: '502',
    title: 'The service did not respond',
    body: 'The page did not load. Try again.',
    primary: 'Try again',
  },
  '503': {
    code: '503',
    title: 'The site is temporarily unavailable',
    body: 'Try again shortly.',
    primary: 'Try again',
  },
  '504': {
    code: '504',
    title: 'The service took too long to answer',
    body: 'Try again.',
    primary: 'Try again',
  },
  offline: {
    code: '—',
    title: 'This browser is offline',
    body: 'Reconnect, then try again.',
    primary: 'Try again',
  },
}

const RETRY_KINDS = new Set<ErrorKind>(['408', '500', '502', '503', '504', 'offline'])

const primaryCta =
  'inline-flex h-12 items-center justify-center rounded-xl bg-signal-strong px-6 text-sm font-semibold text-white no-underline shadow-[0_14px_28px_-10px_rgb(59_130_246_/_0.6)] transition-colors hover:bg-signal-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink'
const outlineCta =
  'inline-flex h-12 items-center justify-center rounded-xl border border-line-strong bg-ink-2/60 px-6 text-sm font-semibold text-paper no-underline transition-colors hover:border-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mist'

function reload() {
  window.location.reload()
}

export function StatusErrorPage({
  kind,
  inset = false,
  homeHref = '/',
  homeLabel,
  onRetry,
  titleId,
}: {
  kind: ErrorKind
  inset?: boolean
  shell?: boolean
  homeHref?: string
  homeLabel?: string
  onRetry?: () => void
  titleId?: string
}) {
  const page = COPY[kind]
  const [note, setNote] = useState<string | null>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const primaryLabel = homeLabel ?? page.primary
  const primaryHref = kind === '401' ? '/login' : homeHref
  const retries = RETRY_KINDS.has(kind)

  useEffect(() => {
    const previous = document.title
    document.title = `${page.title} · ${APP_NAME}`
    return () => {
      document.title = previous
    }
  }, [page.title])

  useEffect(() => {
    if (kind === 'offline') retryRef.current?.focus()
  }, [kind])

  function goBack() {
    if (window.history.length > 1) window.history.back()
    else window.location.assign(homeHref)
  }

  function retry() {
    if (kind === 'offline' && !navigator.onLine) {
      setNote('Still offline.')
      return
    }
    if (onRetry) {
      onRetry()
      return
    }
    reload()
  }

  const body = (
    <section
      className={cn(
        'flex min-h-svh w-full items-center justify-center bg-ink px-4 py-16 text-center text-paper',
        inset && 'fixed inset-0 z-[80]',
      )}
      data-testid={`error-page-${kind}`}
    >
      <div className="w-full max-w-lg">
        <p className="font-display text-6xl font-extrabold leading-none tracking-[-0.04em] sm:text-7xl">
          <span className="sbb-gradient-text">{page.code}</span>
        </p>
        <h1 id={titleId} className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {page.title}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-base text-mist">{page.body}</p>
        {note ? <p className="mt-3 text-sm text-put">{note}</p> : null}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {retries ? (
            <ActionButton onClick={retry} buttonRef={retryRef}>
              {page.primary}
            </ActionButton>
          ) : (
            <Link to={primaryHref} className={primaryCta}>
              {primaryLabel}
            </Link>
          )}
          {retries ? (
            <Link to={homeHref} className={outlineCta}>
              {homeLabel ?? 'Return home'}
            </Link>
          ) : (
            <button type="button" className={outlineCta} onClick={goBack}>
              Go back
            </button>
          )}
        </div>
      </div>
    </section>
  )

  return body
}

function ActionButton({
  onClick,
  buttonRef,
  children,
}: {
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
  children: ReactNode
}) {
  return (
    <button ref={buttonRef} type="button" className={primaryCta} onClick={onClick}>
      {children}
    </button>
  )
}

export function NotFoundPage(props: { inset?: boolean; shell?: boolean; homeHref?: string; homeLabel?: string }) {
  return <StatusErrorPage kind="404" shell={props.inset ? false : props.shell} {...props} />
}
