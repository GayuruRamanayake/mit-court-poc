const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/** Converts an http(s) base URL into the matching ws(s) URL for the given session. */
export function buildWebSocketUrl(sessionId: string): string {
  const wsBase = API_BASE.replace(/^http/, 'ws');
  return `${wsBase}/ws/transcribe/${sessionId}`;
}

export function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}