// Shared recharts <Tooltip> props. Recharts' default hover cursor is a light #ccc band,
// which flashes bright over the dark console -- --color-chart-cursor gives each theme a
// band that sits just off its own background instead.
export const chartTooltip = {
  cursor: { fill: 'var(--color-chart-cursor)' },
  contentStyle: {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
  },
};
