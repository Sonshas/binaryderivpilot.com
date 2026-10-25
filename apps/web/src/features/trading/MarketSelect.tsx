import { useMemo } from 'react'
import { buildMarketSections } from '@/domain/market-sections'
import type { Market } from '@/types'

export function MarketSelect({
  markets,
  selected,
  onSelect,
}: {
  markets: Market[]
  selected: string
  onSelect: (symbol: string) => void
}) {
  const sections = useMemo(() => buildMarketSections(markets, []), [markets])
  const current = markets.find((market) => market.symbol === selected) ?? null

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1.5" data-testid="market-select">
      <label className="min-w-0">
        <span className="sr-only">Market</span>
        <select
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
          aria-label="Market"
          title={current?.displayName}
          className="h-8 w-[min(15rem,52vw)] truncate rounded-lg border border-line bg-ink-2 px-2 text-sm font-semibold text-paper outline-none focus:border-signal focus:ring-2 focus:ring-signal/25"
        >
          {markets.length === 0 ? <option value={selected}>{selected || 'Loading markets…'}</option> : null}
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <optgroup key={section.id} label={section.label}>
                {section.items.map((market) => (
                  <option key={`${section.id}-${market.symbol}`} value={market.symbol}>
                    {market.displayName}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>
      </label>
    </div>
  )
}
