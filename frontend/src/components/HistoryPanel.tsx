import { useEffect, useState } from 'react';
import type { SavedSession } from '../types/transcript';
import { getSessionHistory, getSessionDetail, deleteSessionFromHistory, type SessionSummary } from '../utils/history';
import './HistoryPanel.css';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadSession: (session: SavedSession) => void;
  currentSessionId: string;
  refreshKey: number; // bump this whenever a new session is saved, to force a re-fetch
}

export function HistoryPanel({ isOpen, onClose, onLoadSession, currentSessionId, refreshKey }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    getSessionHistory()
      .then(setSessions)
      .finally(() => setLoading(false));
  }, [isOpen, refreshKey]);

  if (!isOpen) return null;

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSessionFromHistory(sessionId);
    setSessions(await getSessionHistory());
  };

  const handleSelect = async (sessionId: string) => {
    setLoadingId(sessionId);
    const full = await getSessionDetail(sessionId);
    setLoadingId(null);
    if (full) {
      onLoadSession(full);
      onClose();
    }
  };

  return (
    <div className="history-panel__backdrop" onClick={onClose}>
      <div className="history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="history-panel__header">
          <h2 className="history-panel__title">Session History</h2>
          <button className="history-panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="history-panel__note">
          Saved on the server — accessible from any device, as long as the backend and database stay running.
        </p>

        {loading ? (
          <p className="history-panel__empty">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="history-panel__empty">No past sessions yet.</p>
        ) : (
          <div className="history-panel__list">
            {sessions.map((s) => (
              <button
                key={s.session_id}
                className={`history-panel__item ${s.session_id === currentSessionId ? 'history-panel__item--current' : ''}`}
                onClick={() => handleSelect(s.session_id)}
                disabled={loadingId === s.session_id}
              >
                <div className="history-panel__item-main">
                  <span className="history-panel__item-date">
                    {new Date(s.started_at).toLocaleString()}
                  </span>
                  <span className="history-panel__item-meta">
                    {loadingId === s.session_id
                      ? 'Loading…'
                      : `${s.segment_count} segment${s.segment_count === 1 ? '' : 's'} · ${s.speaker_count} speaker(s)`}
                  </span>
                </div>
                <span
                  className="history-panel__delete"
                  onClick={(e) => handleDelete(s.session_id, e)}
                  role="button"
                  aria-label="Delete session"
                  title="Delete this session"
                >
                  🗑
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}