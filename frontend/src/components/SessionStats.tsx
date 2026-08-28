import { useState } from 'react';
import type { SessionStats as Stats } from '../types/transcript';
import './SessionStats.css';

interface SessionStatsProps {
  stats: Stats;
}

export function SessionStats({ stats }: SessionStatsProps) {
  // Default to expanded on desktop (plenty of room, matches the existing
  // look) and compact on mobile (where the mic, stats, and transcript are
  // all fighting for limited vertical space) - either way, tapping toggles
  // it regardless of screen size.
  const [expanded, setExpanded] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 641px)').matches
  );

  const items = [
    { label: 'Speakers detected', value: stats.uniqueSpeakers.toString() },
    { label: 'Segments captured', value: stats.totalSegments.toString() },
    { label: 'Session length', value: formatDuration(stats.sessionDurationSec) },
  ];

  return (
    <button
      className={`session-stats ${expanded ? 'session-stats--expanded' : 'session-stats--compact'}`}
      onClick={() => setExpanded((e) => !e)}
      aria-expanded={expanded}
    >
      {expanded ? (
        items.map((item) => (
          <div className="session-stats__item" key={item.label}>
            <span className="session-stats__value">{item.value}</span>
            <span className="session-stats__label">{item.label}</span>
          </div>
        ))
      ) : (
        <div className="session-stats__summary">
          <span>{stats.uniqueSpeakers} speakers</span>
          <span className="session-stats__dot">·</span>
          <span>{stats.totalSegments} segments</span>
          <span className="session-stats__dot">·</span>
          <span>{formatDuration(stats.sessionDurationSec)}</span>
          <span className="session-stats__hint">tap for details</span>
        </div>
      )}
    </button>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}