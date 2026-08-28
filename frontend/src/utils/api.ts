import type { TranscriptSegment, VoiceProfile } from '../types/transcript';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface ChunkResponse {
  voiceProfiles: VoiceProfile[];
  segments: Omit<TranscriptSegment, 'id' | 'lineNumber'>[];
}

export async function sendAudioChunk(
  sessionId: string,
  blob: Blob
): Promise<ChunkResponse> {
  const formData = new FormData();
  formData.append('audio', blob, 'chunk.webm');
  formData.append('session_id', sessionId);

  const res = await fetch(`${API_BASE}/api/transcribe-chunk`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Backend error (${res.status}): ${errText}`);
  }

  return res.json();
}

export function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
