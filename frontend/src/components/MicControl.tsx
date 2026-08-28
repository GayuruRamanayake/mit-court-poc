import './MicControl.css';

interface MicControlProps {
  isListening: boolean;
  isSpeechActive: boolean;
  onToggle: () => void;
}

export function MicControl({ isListening, isSpeechActive, onToggle }: MicControlProps) {
  return (
    <div className="mic-control">
      <button
        className={`mic-control__button ${isListening ? 'is-listening' : ''} ${
          isSpeechActive ? 'is-speaking' : ''
        }`}
        onClick={onToggle}
        aria-pressed={isListening}
        aria-label={isListening ? 'Stop listening' : 'Start listening'}
      >
        {isListening && <span className="mic-control__ring" />}
        <MicIcon />
      </button>
      <p className="mic-control__status">
        {isListening
          ? isSpeechActive
            ? 'Listening — speech detected'
            : 'Listening for speech'
          : 'Tap to begin the record'}
      </p>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
