import { useEffect, useMemo, useRef } from 'react';
import type { SpeakerDirectory, TranscriptSegment } from '../types/transcript';
import { TranscriptLine } from './TranscriptLine';
import './TranscriptFeed.css';

interface TranscriptFeedProps {
  segments: TranscriptSegment[];
  interimText: string;
  speakerNames: SpeakerDirectory;
  onRenameSpeaker: (rawId: string, newName: string) => void;
  onReassignSegment: (segmentId: string, targetRawId: string) => void;
  onCreateSpeakerAndAssign: (segmentId: string, newName: string) => void;
}

export function TranscriptFeed({
  segments,
  interimText,
  speakerNames,
  onRenameSpeaker,
  onReassignSegment,
  onCreateSpeakerAndAssign,
}: TranscriptFeedProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [segments.length, interimText]);

  // Every distinct raw speaker ID seen so far, in first-appearance order,
  // with its current display name - used both for coloring and as the
  // selectable list when reassigning a single line to an existing speaker.
  const knownSpeakers = useMemo(() => {
    const seen = new Set<string>();
    const list: { rawId: string; displayName: string }[] = [];
    for (const seg of segments) {
      if (!seen.has(seg.speaker)) {
        seen.add(seg.speaker);
        list.push({ rawId: seg.speaker, displayName: speakerNames[seg.speaker] || seg.speaker });
      }
    }
    return list;
  }, [segments, speakerNames]);

  const colorIndexByRawId = useMemo(() => {
    const map = new Map<string, number>();
    knownSpeakers.forEach((s, i) => map.set(s.rawId, i % 5));
    return map;
  }, [knownSpeakers]);

  if (segments.length === 0 && !interimText) {
    return (
      <div className="transcript-feed transcript-feed--empty">
        <p className="transcript-feed__empty-title">The record is open.</p>
        <p className="transcript-feed__empty-sub">
          Begin speaking — each utterance will appear here, numbered and attributed as it's captured.
        </p>
      </div>
    );
  }

  return (
    <div className="transcript-feed">
      <div className="transcript-feed__header">
        <span>Line</span>
        <span>Speaker</span>
        <span>Time</span>
        <span className="transcript-feed__header-text">Transcript</span>
      </div>
      <div className="transcript-feed__body" ref={bodyRef}>
        {segments.map((seg) => (
          <TranscriptLine
            key={seg.id}
            segment={seg}
            displayName={speakerNames[seg.speaker] || seg.speaker}
            colorIndex={colorIndexByRawId.get(seg.speaker) ?? 0}
            knownSpeakers={knownSpeakers}
            onRenameSpeaker={onRenameSpeaker}
            onReassignSegment={onReassignSegment}
            onCreateSpeakerAndAssign={onCreateSpeakerAndAssign}
          />
        ))}
        {interimText && (
          <div className="transcript-line transcript-line--interim">
            <span className="transcript-line__num">
              <span className="transcript-line__live-dot" />
            </span>
            <span className="transcript-line__speaker">…</span>
            <span className="transcript-line__meta" />
            <span className="transcript-line__text transcript-line__text--interim">
              {interimText}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}