export type LanguageCode = 'si' | 'ta' | 'en' | 'unknown';

export interface TranscriptSegment {
  id: string;
  lineNumber: number;
  speaker: string; // raw ID from Azure, e.g. "Guest-1" - never edited directly
  language: LanguageCode;
  startTime: string; // "MM:SS"
  endTime: string;
  text: string;
  confidence: 'high' | 'low';
}

/** Maps a raw speaker ID (e.g. "Guest-1") to a human-assigned display name (e.g. "Judge Perera"). */
export type SpeakerDirectory = Record<string, string>;

export interface SavedSession {
  sessionId: string;
  startedAt: number; // epoch ms
  segments: TranscriptSegment[];
  speakerNames: SpeakerDirectory;
}

export type SessionStatus = 'idle' | 'listening' | 'processing' | 'error';

export interface SessionStats {
  totalSegments: number;
  uniqueSpeakers: number;
  sessionDurationSec: number;
}