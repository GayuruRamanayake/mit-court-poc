import { useState, useRef, useEffect } from 'react';
import type { TranscriptSegment } from '../types/transcript';
import './TranscriptLine.css';

const LANGUAGE_LABELS: Record<string, string> = {
  si: 'SI',
  ta: 'TA',
  en: 'EN',
  unknown: '—',
};

interface KnownSpeaker {
  rawId: string;
  displayName: string;
}

interface TranscriptLineProps {
  segment: TranscriptSegment;
  displayName: string;
  colorIndex: number;
  knownSpeakers: KnownSpeaker[];
  onRenameSpeaker: (rawId: string, newName: string) => void;
  onReassignSegment: (segmentId: string, targetRawId: string) => void;
  onCreateSpeakerAndAssign: (segmentId: string, newName: string) => void;
}

export function TranscriptLine({
  segment,
  displayName,
  colorIndex,
  knownSpeakers,
  onRenameSpeaker,
  onReassignSegment,
  onCreateSpeakerAndAssign,
}: TranscriptLineProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'rename' | 'reassign'>('menu');
  const [renameValue, setRenameValue] = useState(displayName);
  const [newSpeakerValue, setNewSpeakerValue] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setMode('menu');
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const openMenu = () => {
    setRenameValue(displayName);
    setNewSpeakerValue('');
    setMode('menu');
    setMenuOpen(true);
  };

  const submitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed) onRenameSpeaker(segment.speaker, trimmed);
    setMenuOpen(false);
  };

  const submitNewSpeaker = () => {
    const trimmed = newSpeakerValue.trim();
    if (trimmed) onCreateSpeakerAndAssign(segment.id, trimmed);
    setMenuOpen(false);
  };

  return (
    <div
      className={`transcript-line ${segment.confidence === 'low' ? 'transcript-line--low-confidence' : ''}`}
    >
      <span className="transcript-line__num">{segment.lineNumber}</span>

      <span className="transcript-line__speaker-wrap">
        <button
          className={`transcript-line__speaker speaker-${colorIndex}`}
          onClick={openMenu}
          title="Click to rename or reassign this speaker"
        >
          <span className="transcript-line__speaker-text">{displayName}</span>
          <span className="transcript-line__edit-icon" aria-hidden="true">✎</span>
        </button>

        {menuOpen && (
          <div className="speaker-popover" ref={popoverRef}>
            {mode === 'menu' && (
              <div className="speaker-popover__menu">
                <button className="speaker-popover__option" onClick={() => setMode('rename')}>
                  Rename "{displayName}" everywhere
                </button>
                <button className="speaker-popover__option" onClick={() => setMode('reassign')}>
                  Fix speaker for this line only
                </button>
              </div>
            )}

            {mode === 'rename' && (
              <div className="speaker-popover__form">
                <label className="speaker-popover__label">
                  Applies to every line from this speaker
                </label>
                <input
                  className="speaker-popover__input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitRename()}
                  onFocus={(e) => e.target.select()}
                  autoFocus
                />
                <div className="speaker-popover__actions">
                  <button className="speaker-popover__btn speaker-popover__btn--primary" onClick={submitRename}>
                    Save
                  </button>
                  <button className="speaker-popover__btn" onClick={() => setMode('menu')}>
                    Back
                  </button>
                </div>
              </div>
            )}

            {mode === 'reassign' && (
              <div className="speaker-popover__form">
                <label className="speaker-popover__label">Assign this one line to:</label>
                <div className="speaker-popover__list">
                  {knownSpeakers
                    .filter((s) => s.rawId !== segment.speaker)
                    .map((s) => (
                      <button
                        key={s.rawId}
                        className="speaker-popover__option"
                        onClick={() => {
                          onReassignSegment(segment.id, s.rawId);
                          setMenuOpen(false);
                        }}
                      >
                        {s.displayName}
                      </button>
                    ))}
                </div>
                <label className="speaker-popover__label speaker-popover__label--spaced">
                  Or create a new speaker:
                </label>
                <input
                  className="speaker-popover__input"
                  placeholder="e.g. Witness"
                  value={newSpeakerValue}
                  onChange={(e) => setNewSpeakerValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitNewSpeaker()}
                />
                <div className="speaker-popover__actions">
                  <button className="speaker-popover__btn speaker-popover__btn--primary" onClick={submitNewSpeaker}>
                    Create &amp; assign
                  </button>
                  <button className="speaker-popover__btn" onClick={() => setMode('menu')}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </span>

      <span className="transcript-line__meta">
        <span className={`lang-badge lang-badge--${segment.language}`}>
          {LANGUAGE_LABELS[segment.language] ?? segment.language}
        </span>
        <span className="transcript-line__time">{segment.startTime}</span>
      </span>

      <span className="transcript-line__text" lang={segment.language}>
        {segment.text}
        {segment.confidence === 'low' && (
          <span className="transcript-line__flag" title="Low confidence — recommend human review">
            ⚠ unverified
          </span>
        )}
      </span>
    </div>
  );
}