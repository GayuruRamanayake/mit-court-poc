import type { SessionStats as Stats } from '../types/transcript';
import './SessionStats.css';

interface SessionStatsProps {
  stats: Stats;
}

export function SessionStats({ stats }: SessionStatsProps) {
  const items = [
    { label: 'Speakers detected', value: stats.uniqueSpeakers.toString() },
    { label: 'Segments captured', value: stats.totalSegments.toString() },
    { label: 'Session length', value: formatDuration(stats.sessionDurationSec) },
  ];

  return (
    <div className="session-stats">
      {items.map((item) => (
        <div className="session-stats__item" key={item.label}>
          <span className="session-stats__value">{item.value}</span>
          <span className="session-stats__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}