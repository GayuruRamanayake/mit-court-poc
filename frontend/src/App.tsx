import { useCallback, useEffect, useRef, useState } from 'react';
import { MicControl } from './components/MicControl';
import { TranscriptFeed } from './components/TranscriptFeed';
import { SessionStats } from './components/SessionStats';
import { ExportMenu } from './components/ExportMenu';
import { HistoryPanel } from './components/HistoryPanel';
import { useLiveTranscription, type FinalSegment } from './hooks/useLiveTranscription';
import { buildWebSocketUrl, createSessionId } from './utils/session';
import { formatSecondsToTime } from './utils/time';
import { saveSessionToHistory } from './utils/history';
import type { SavedSession, SessionStats as Stats, SpeakerDirectory, TranscriptSegment } from './types/transcript';
import './App.css';

function App() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, setTick] = useState(0); // forces a re-render each second so the live session timer visibly ticks
  const [speakerNames, setSpeakerNames] = useState<SpeakerDirectory>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const sessionIdRef = useRef<string>(createSessionId());
  const sessionStartRef = useRef<number | null>(null);
  const lineCounterRef = useRef(0);
  const manualSpeakerCounterRef = useRef(0);

  // Because Azure runs ONE continuous session for the whole recording (see
  // backend/azure_speech_service.py), speaker labels and timestamps are
  // already consistent and session-relative straight out of the box - no
  // need for the cross-chunk offset/merging logic the old Gemini pipeline
  // required.
  const handleFinalSegment = useCallback((raw: FinalSegment) => {
    setInterimText(''); // the draft line is now superseded by a real finalized line
    lineCounterRef.current += 1;
    const newSegment: TranscriptSegment = {
      id: `${sessionIdRef.current}-${lineCounterRef.current}`,
      lineNumber: lineCounterRef.current,
      speaker: raw.speaker,
      language: (['si', 'ta', 'en'].includes(raw.language) ? raw.language : 'unknown') as TranscriptSegment['language'],
      startTime: formatSecondsToTime(raw.offset_sec),
      endTime: formatSecondsToTime(raw.offset_sec + raw.duration_sec),
      text: raw.text,
      confidence: raw.confidence,
    };
    setSegments((prev) => [...prev, newSegment]);
  }, []);

  const handleInterim = useCallback((text: string) => {
    setInterimText(text);
  }, []);

  const handleError = useCallback((message: string) => {
    setErrorMsg(message);
  }, []);

  const handleConnectionLost = useCallback(() => {
    setErrorMsg('Connection lost — the mic stopped listening unexpectedly. Tap the mic to reconnect.');
  }, []);

  // Renames a speaker EVERYWHERE - since display name is looked up from
  // this map by raw ID at render time, updating one entry here instantly
  // relabels every line that speaker has (and will have).
  const handleRenameSpeaker = useCallback((rawId: string, newName: string) => {
    setSpeakerNames((prev) => ({ ...prev, [rawId]: newName }));
  }, []);

  // Fixes ONE specific line's speaker attribution (for diarization
  // mistakes) by pointing it at an already-known speaker's raw ID,
  // without touching any other line.
  const handleReassignSegment = useCallback((segmentId: string, targetRawId: string) => {
    setSegments((prev) =>
      prev.map((seg) => (seg.id === segmentId ? { ...seg, speaker: targetRawId } : seg))
    );
  }, []);

  // Same idea, but for when the correct speaker isn't in the known list
  // at all yet (diarization attributed a line to the wrong person, and
  // the right person hasn't had any other line correctly attributed to
  // them) - mints a new synthetic raw ID, names it immediately, and
  // reassigns just this one line to it.
  const handleCreateSpeakerAndAssign = useCallback((segmentId: string, newName: string) => {
    manualSpeakerCounterRef.current += 1;
    const newRawId = `Manual-${manualSpeakerCounterRef.current}`;
    setSpeakerNames((prev) => ({ ...prev, [newRawId]: newName }));
    setSegments((prev) =>
      prev.map((seg) => (seg.id === segmentId ? { ...seg, speaker: newRawId } : seg))
    );
  }, []);

  const { isListening, start, stop } = useLiveTranscription({
    wsUrl: buildWebSocketUrl(sessionIdRef.current),
    onFinalSegment: handleFinalSegment,
    onInterim: handleInterim,
    onError: handleError,
    onConnectionLost: handleConnectionLost,
  });

  const handleToggle = useCallback(async () => {
    if (isListening) {
      stop();
    } else {
      sessionIdRef.current = createSessionId();
      sessionStartRef.current = Date.now();
      lineCounterRef.current = 0;
      manualSpeakerCounterRef.current = 0;
      setSegments([]);
      setInterimText('');
      setErrorMsg(null);
      setSpeakerNames({});
      try {
        await start();
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Microphone access was denied or unavailable.'
        );
      }
    }
  }, [isListening, start, stop]);

  // Live-ticking session timer: without this, "Session length" only
  // updated when a new transcript segment arrived, so it looked frozen
  // during quiet moments even though time was actually passing.
  useEffect(() => {
    if (!isListening) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  // Autosave to browser history on every new segment or rename/reassign,
  // not just when the session ends - so an accidental refresh or crash
  // mid-recording doesn't lose the transcript. Only saves once there's
  // actually something worth keeping.
  useEffect(() => {
    if (segments.length === 0 || sessionStartRef.current === null) return;
    saveSessionToHistory({
      sessionId: sessionIdRef.current,
      startedAt: sessionStartRef.current,
      segments,
      speakerNames,
    });
    setHistoryRefreshKey((k) => k + 1);
  }, [segments, speakerNames]);

  const handleLoadSession = useCallback((session: SavedSession) => {
    // Loading a past session is a read/edit view, not a live recording -
    // if the mic is currently active, stop it first so we don't end up
    // with live audio writing into a session we just navigated away from.
    if (isListening) stop();
    sessionIdRef.current = session.sessionId;
    sessionStartRef.current = session.startedAt;
    lineCounterRef.current = session.segments.length;
    setSegments(session.segments);
    setSpeakerNames(session.speakerNames);
    setInterimText('');
    setErrorMsg(null);
  }, [isListening, stop]);

  const uniqueSpeakers = new Set(segments.map((s) => s.speaker)).size;
  const sessionDurationSec = sessionStartRef.current
    ? (Date.now() - sessionStartRef.current) / 1000
    : 0;

  const stats: Stats = {
    totalSegments: segments.length,
    uniqueSpeakers,
    sessionDurationSec,
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title-block">
          <span className="app__eyebrow">Multilingual Court Transcription — POC</span>
          <div className="app__title-row">
            <h1 className="app__title">The Record</h1>
            {isListening && (
              <span className="app__live-badge">
                <span className="app__live-dot" />
                LIVE
              </span>
            )}
          </div>
        </div>
        <div className="app__header-right">
          <button className="app__history-btn" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <ExportMenu segments={segments} sessionId={sessionIdRef.current} speakerNames={speakerNames} />
          <div className="app__session-id">
            Session <span>{sessionIdRef.current.slice(-8)}</span>
          </div>
        </div>
      </header>

      <main className="app__main">
        <div className="app__control-column">
          <MicControl isListening={isListening} isSpeechActive={false} onToggle={handleToggle} />
          {errorMsg && <p className="app__error">{errorMsg}</p>}
          <SessionStats stats={stats} />
        </div>

        <TranscriptFeed
          segments={segments}
          interimText={interimText}
          speakerNames={speakerNames}
          onRenameSpeaker={handleRenameSpeaker}
          onReassignSegment={handleReassignSegment}
          onCreateSpeakerAndAssign={handleCreateSpeakerAndAssign}
        />
      </main>

      <HistoryPanel
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onLoadSession={handleLoadSession}
        currentSessionId={sessionIdRef.current}
        refreshKey={historyRefreshKey}
      />
    </div>
  );
}

export default App;