/** Parses "MM:SS" into total seconds. Returns 0 for malformed input. */
export function parseTimeToSeconds(time: string): number {
  const parts = time.split(':').map((p) => parseInt(p, 10));
  if (parts.length !== 2 || parts.some(isNaN)) return 0;
  const [minutes, seconds] = parts;
  return minutes * 60 + seconds;
}

/** Formats total seconds back into "MM:SS". */
export function formatSecondsToTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}