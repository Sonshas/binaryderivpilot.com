import { describe, expect, it } from 'vitest'
import webSource from './admin-batch.ts?raw'
import denoSource from '../../../../supabase/functions/_shared/admin-batch.ts?raw'
import adminUsersSource from '../../../../supabase/functions/admin-users/index.ts?raw'
import { ID_CHUNK_SIZE, PAGE_SIZE, chunk, readAllPages, readByIds, type PageResult } from '@/domain/admin-batch'

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
}

/** Fake PostgREST table: honours `.in()` ids + `.range()` and caps responses at `maxRows`. */
function fakeTable(rows: { user_id: string }[], maxRows = PAGE_SIZE) {
  const calls: { ids: number; from: number; to: number }[] = []
  const fetchPage = async (part: string[], from: number, to: number): Promise<PageResult<{ user_id: string }>> => {
    calls.push({ ids: part.length, from, to })
    const wanted = new Set(part)
    const matching = rows.filter((r) => wanted.has(r.user_id))
    return { data: matching.slice(from, Math.min(to + 1, from + maxRows)), error: null }
  }
  return { calls, fetchPage }
}

describe('admin-batch', () => {
  it('supabase/functions/_shared/admin-batch.ts is identical to domain/admin-batch.ts', () => {
    expect(denoSource).toBe(webSource)
  })

  it('chunks ids into bounded groups', () => {
    expect(chunk(ids(1706), ID_CHUNK_SIZE).map((c) => c.length)).toEqual([...Array(11).fill(150), 56])
    expect(chunk([], 10)).toEqual([])
    expect(() => chunk([1], 0)).toThrow()
  })

  it('pages past the PostgREST max-rows cap', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i)
    const rows = await readAllPages(async (from, to) => ({ data: all.slice(from, to + 1), error: null }))
    expect(rows).toHaveLength(2500)
  })

  it('throws on a query error instead of returning a partial list', async () => {
    await expect(readAllPages(async () => ({ data: null, error: { message: 'Bad Request' } }))).rejects.toThrow('Bad Request')
  })

  it('loads every user row for 1706 users without oversized id filters', async () => {
    const userIds = ids(1706)
    const rows = userIds.flatMap((id, i) => Array.from({ length: i % 3 }, () => ({ user_id: id })))
    const table = fakeTable(rows)
    const result = await readByIds(userIds, table.fetchPage)
    expect(result).toHaveLength(rows.length)
    expect(Math.max(...table.calls.map((c) => c.ids))).toBeLessThanOrEqual(ID_CHUNK_SIZE)
  })

  it('pages within a chunk when one chunk has more rows than a page', async () => {
    const userIds = ids(3)
    const rows = Array.from({ length: 2300 }, (_, i) => ({ user_id: userIds[i % 3] }))
    const result = await readByIds(userIds, fakeTable(rows).fetchPage)
    expect(result).toHaveLength(2300)
  })

  it('dedupes ids and skips the request when there are none', async () => {
    const table = fakeTable([])
    expect(await readByIds([], table.fetchPage)).toEqual([])
    expect(table.calls).toHaveLength(0)
    await readByIds(['a', 'a', 'b'], table.fetchPage)
    expect(table.calls[0].ids).toBe(2)
  })
})

describe('admin-users edge function', () => {
  it('never sends the whole user id list in one .in() filter', () => {
    expect(adminUsersSource).not.toMatch(/\.in\('user_id', (userIds|ids)\)/)
    expect(adminUsersSource).not.toMatch(/\.limit\(5000\)/)
  })
})
