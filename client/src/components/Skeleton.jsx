export default function Skeleton({ rows = 4, label = 'Loading…' }) {
  return <div className="skeleton-stack" role="status" aria-label={label}>{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index} />)}</div>;
}
