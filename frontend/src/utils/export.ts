import type { SpeakerDirectory, TranscriptSegment } from '../types/transcript';

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportAsText(segments: TranscriptSegment[], sessionId: string, speakerNames: SpeakerDirectory) {
  const lines = segments.map((s) => {
    const displayName = speakerNames[s.speaker] || s.speaker;
    return `[${s.lineNumber}] ${displayName} (${s.language.toUpperCase()}) ${s.startTime}: ${s.text}${s.confidence === 'low' ? '  [unverified]' : ''}`;
  });
  triggerDownload(`transcript-${sessionId}.txt`, lines.join('\n'), 'text/plain');
}

export function exportAsJson(segments: TranscriptSegment[], sessionId: string, speakerNames: SpeakerDirectory) {
  const withDisplayNames = segments.map((s) => ({
    ...s,
    speakerDisplayName: speakerNames[s.speaker] || s.speaker,
  }));
  triggerDownload(
    `transcript-${sessionId}.json`,
    JSON.stringify({ sessionId, segments: withDisplayNames }, null, 2),
    'application/json'
  );
}