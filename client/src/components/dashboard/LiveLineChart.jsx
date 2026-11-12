import { memo, useMemo } from 'react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const formatTime = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/**
 * Rolling-window live chart (Recharts).
 *
 * Performance rules:
 *  - `isAnimationActive={false}` on every element (animation would queue frames),
 *  - the parent buffers WebSocket messages and only re-renders every ~200 ms,
 *  - `React.memo` + `useMemo` so an unchanged series never re-renders the subtree.
 *
 * @param {{ points: { t: number, v: number, unit: string }[],
 *           threshold?: { operator: string, value: number } | null,
 *           unit?: string, height?: number }} props
 */
function LiveLineChart({ points, threshold = null, unit = '', height = 280 }) {
  const data = useMemo(
    () => points.map((p) => ({ time: formatTime(p.t), value: Math.round(p.v * 100) / 100 })),
    [points],
  );
  const unitLabel = unit || points[points.length - 1]?.unit || '';

  return (
    <div className="chart-shell" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, left: -6, bottom: 4 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="time" minTickGap={40} tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis width={46} domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} tickLine={false} axisLine={false} />
          <Tooltip
            animationDuration={0}
            contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 12 }}
            formatter={(value) => [`${value} ${unitLabel}`, 'value']}
            labelStyle={{ color: 'var(--ink-soft)' }}
          />
          {threshold && Number.isFinite(threshold.value) && (
            <ReferenceLine
              y={threshold.value}
              stroke="#d7654f"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: `threshold ${threshold.operator} ${threshold.value}`,
                position: 'insideTopRight',
                fontSize: 11,
                fill: '#d7654f',
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--teal)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, animationDuration: 0 }}
            isAnimationActive={false}
            isConnectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(LiveLineChart);
