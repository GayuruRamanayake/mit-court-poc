# The Record — Court Transcription POC (Frontend)

React + TypeScript + Vite frontend for the multilingual (Sinhala / Tamil / English)
live speech-to-text + speaker diarization proof of concept.

## Design notes

- The transcript renders as numbered lines, deliberately styled after real court
  transcript conventions (line-numbered pages), rather than a chat-bubble feed.
- Palette: charcoal/navy background with a brass accent (courtroom/seal tone),
  muted crimson reserved only for the live listening state.
- Type: Source Serif 4 for transcript text and headings, IBM Plex Mono for
  timestamps/line numbers/labels, IBM Plex Sans for UI chrome.

## How it works

1. Tap the mic to start. `useVoiceCapture` opens the microphone and uses
   RMS-energy-based voice activity detection (no heavy ML dependency) to cut
   speech into chunks whenever a natural pause is detected.
2. Each finished chunk (webm/opus blob) is POSTed to the backend at
   `POST /api/transcribe-chunk` as multipart form data, along with a
   `session_id` so the backend can maintain speaker continuity across chunks.
3. The backend (see `../backend`) runs the two-stage Gemini prompt (voice
   profiling, then segment assignment) and returns structured JSON.
4. Segments are appended to the transcript feed with line numbers, speaker
   labels, and language badges.

## Setup

```bash
npm install
cp .env.example .env   # point VITE_API_URL at your backend
npm run dev
```

## Environment variables

| Variable | Description |
|---|---|
| `VITE_API_URL` | Base URL of the backend API (e.g. `http://localhost:8000` locally, your Railway backend URL in production) |

## Build

```bash
npm run build
```

Outputs to `dist/` — deploy this as a static site (Railway static service,
Vercel, Netlify, etc.), pointed at your deployed backend via `VITE_API_URL`.

## Known limitations (POC stage)

- VAD is energy-threshold based — works well on clean single-mic audio, may
  need tuning (`silenceThreshold` in `useVoiceCapture.ts`) for noisier rooms.
- Speaker labels are only consistent *within* a session's chunks if the
  backend carries forward voice profiles/reference audio across calls — see
  backend README for the speaker-registry approach.
