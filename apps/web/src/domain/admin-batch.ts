// Batched reads for admin lists, shared by the admin-users Edge Function and the web app.
// apps/web/src/domain/admin-batch.ts must stay byte-identical (enforced by admin-batch.test.ts).
//
// PostgREST puts `.in()` filters in the request URL (too many ids -> 400 Bad Request) and caps
// every response at its max-rows setting (1000), so large user sets are chunked and paged.

export const ID_CHUNK_SIZE = 150
export const PAGE_SIZE = 1000
export const MAX_PAGES = 200
const CHUNK_CONCURRENCY = 4

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export function chunk<T>(items: readonly T[], size = ID_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunk size must be a positive integer')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Reads every page of a query. `fetchPage` must apply a stable order and `.range(from, to)`. */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? PAGE_SIZE
  const maxPages = options.maxPages ?? MAX_PAGES
  const rows: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}

/** Reads all rows matching a set of ids, `chunkSize` ids per request, each chunk fully paged. */
export async function readByIds<T>(
  ids: readonly string[],
  fetchPage: (ids: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { chunkSize?: number; pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const chunks = chunk(unique, options.chunkSize ?? ID_CHUNK_SIZE)
  const rows: T[] = []
  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const group = chunks.slice(i, i + CHUNK_CONCURRENCY)
    const results = await Promise.all(
      group.map((part) => readAllPages<T>((from, to) => fetchPage(part, from, to), options)),
    )
    for (const result of results) rows.push(...result)
  }
  return rows
}
