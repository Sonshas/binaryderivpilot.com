/** AbortSignal that fires after `ms`. Works where `AbortSignal.timeout` is missing (older Safari / WebViews). */
export function abortSignalAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  const id = globalThis.setTimeout(() => {
    try {
      controller.abort(new DOMException('signal timed out', 'TimeoutError'))
    } catch {
      controller.abort()
    }
  }, Math.max(0, ms))
  const { signal } = controller
  const clear = () => globalThis.clearTimeout(id)
  signal.addEventListener('abort', clear, { once: true })
  return signal
}

/** Race a promise against a timeout. Clears the timer when the promise settles. */
export async function raceWithTimeout<T>(promise: Promise<T>, ms: number, label = 'Request timed out'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(label)), Math.max(0, ms))
      }),
    ])
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer)
  }
}

/**
 * Soft-timeout a promise without cancelling it. On timeout, returns `fallback` while
 * the original promise keeps running and may call `onLate` when it eventually settles.
 */
export async function softTimeoutKeepGoing<T>(
  promise: PromiseLike<T>,
  ms: number,
  fallback: T,
  onLate?: (value: T) => void,
): Promise<T> {
  let settled = false
  const late = Promise.resolve(promise).then(
    (value) => {
      if (settled) onLate?.(value)
      return value
    },
    () => fallback,
  )
  try {
    const value = await raceWithTimeout(late, ms)
    settled = true
    return value
  } catch {
    settled = true
    return fallback
  }
}
