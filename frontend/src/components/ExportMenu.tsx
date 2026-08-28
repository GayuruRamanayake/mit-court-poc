import { useState, useRef, useEffect } from 'react';
import { exportAsText, exportAsJson } from '../utils/export';
import type { SpeakerDirectory, TranscriptSegment } from '../types/transcript';
import './ExportMenu.css';

interface ExportMenuProps {
  segments: TranscriptSegment[];
  sessionId: string;
  speakerNames: SpeakerDirectory;
}

export function ExportMenu({ segments, sessionId, speakerNames }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const disabled = segments.length === 0;

  return (
    <div className="export-menu" ref={menuRef}>
      <button
        className="export-menu__trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
      >
        Export
      </button>
      {open && (
        <div className="export-menu__dropdown">
          <button
            className="export-menu__item"
            onClick={() => {
              exportAsText(segments, sessionId, speakerNames);
              setOpen(false);
            }}
          >
            Download as .txt
          </button>
          <button
            className="export-menu__item"
            onClick={() => {
              exportAsJson(segments, sessionId, speakerNames);
              setOpen(false);
            }}
          >
            Download as .json
          </button>
        </div>
      )}
    </div>
  );
}