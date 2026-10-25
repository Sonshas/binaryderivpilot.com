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
