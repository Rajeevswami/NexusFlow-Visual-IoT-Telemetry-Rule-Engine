import { memo, useMemo } from 'react';

const round = (value) => (value == null || Number.isNaN(value) ? '—' : (Math.round(value * 100) / 100).toString());

/**
 * Latest / average / min / max / messages-per-second cards for the selected device.
 * Pure memoised computation over the buffered series — no subscriptions of its own.
 *
 * @param {{ stats: { latest: object|null, average: number|null, min: number|null, max: number|null },
 *           messagesPerSecond: number, pointCount: number, unit?: string }} props
 */
function StatCards({ stats, messagesPerSecond, pointCount, unit = '' }) {
  const cards = useMemo(() => {
    const suffix = unit || stats.latest?.unit || '';
    return [
      { key: 'latest', label: 'Latest value', value: round(stats.latest?.v), accent: 'live' },
      { key: 'average', label: `Average (${pointCount} pts)`, value: round(stats.average) },
      { key: 'min', label: 'Minimum', value: round(stats.min) },
      { key: 'max', label: 'Maximum', value: round(stats.max) },
      { key: 'mps', label: 'Messages / sec', value: String(messagesPerSecond) },
    ].map((card) => ({ ...card, suffix: card.key === 'mps' || card.value === '—' ? '' : suffix }));
  }, [stats, messagesPerSecond, pointCount, unit]);

  return (
    <div className="stat-cards">
      {cards.map((card) => (
        <div key={card.key} className={`dash-stat ${card.accent === 'live' ? 'dash-stat-live' : ''}`}>
          <small>{card.label}</small>
          <strong className="tabular-nums">
            {card.value}
            {card.suffix ? <em> {card.suffix}</em> : null}
          </strong>
        </div>
      ))}
    </div>
  );
}

export default memo(StatCards);
