/** Matches connect_timeout in the direct SQL client. Shorter slices never connect. */
export const FRESH_CONNECT_MS = 2_500

/**
 * Split a caller budget into pooler attempts that can finish a TCP connect.
 * Three slices of a 4.5s dashboard budget were 1.5s each, so every attempt
 * died before the pooler accepted the socket and the overview came back
 * with users only.
 */
export function freshAttemptPlan(
  timeoutMs: number,
  urlCount: number,
): { attempts: number; perAttemptMs: number } {
  const budget = Math.max(500, Math.floor(timeoutMs))
  const urls = Math.max(0, Math.floor(urlCount))
  if (urls === 0) return { attempts: 0, perAttemptMs: budget }
  // One attempt for the whole budget. Splitting it aborted deposit reads that
  // were still running on a slow pooler.
  if (budget < FRESH_CONNECT_MS) return { attempts: 1, perAttemptMs: budget }
  return { attempts: 1, perAttemptMs: budget }
}
