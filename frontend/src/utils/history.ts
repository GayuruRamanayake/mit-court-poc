import type { SavedSession } from '../types/transcript';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface SessionSummary {
  session_id: string;
  started_at: number;
  segment_count: number;
  speaker_count: number;
}

/**
 * Saves/updates a session server-side. Called repeatedly during a live
 * session (not just at the end) so a browser crash or refresh doesn't
 * lose the transcript - the backend does an upsert keyed by session_id,
 * so repeated calls just overwrite rather than duplicate.
 *
 * Fire-and-forget by design: a failed autosave shouldn't interrupt the
 * live transcription experience, so errors are logged, not thrown.
 */
export async function saveSessionToHistory(session: SavedSession) {
  try {
    await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.sessionId,
        started_at: session.startedAt,
        segments: session.segments,
        speaker_names: session.speakerNames,
      }),
    });
  } catch (err) {
    console.warn('Failed to save session to server:', err);
  }
}

/** Lightweight list for the history panel - counts only, not full transcripts. */
export async function getSessionHistory(): Promise<SessionSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`);
    if (!res.ok) return [];
    return res.json();
  } catch (err) {
    console.warn('Failed to fetch session history:', err);
    return [];
  }
}

/** Fetches the FULL transcript for one session - only called when the user actually opens it. */
export async function getSessionDetail(sessionId: string): Promise<SavedSession | null> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      sessionId: data.session_id,
      startedAt: data.started_at,
      segments: data.segments,
      speakerNames: data.speaker_names,
    };
  } catch (err) {
    console.warn('Failed to fetch session detail:', err);
    return null;
  }
}

export async function deleteSessionFromHistory(sessionId: string) {
  try {
    await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('Failed to delete session:', err);
  }
}