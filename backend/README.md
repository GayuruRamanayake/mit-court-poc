# Court Transcription POC — Backend

FastAPI service that receives live audio chunks from the frontend, runs the
two-stage Gemini diarization + transcription prompt, and maintains speaker
continuity across a session.

## How speaker continuity works across chunks

Gemini's API is stateless — it has no memory of "Speaker 1" from a previous
call. To keep speaker numbering consistent across an entire live session,
this backend:

1. Keeps an in-memory registry per `session_id` (`session_registry.py`) of
   every voice profile discovered so far.
2. For each NEW chunk, sends Gemini:
   - A short (~4s) reference audio snippet for every already-known speaker
     in the session, clearly labeled.
   - The new audio chunk to process.
   - A prompt instructing it to match new voices against the known
     reference snippets before creating a new speaker label.
3. Any genuinely new voice gets registered, with a trimmed snippet of that
   chunk stored as its reference for future chunks.

This is the two-stage prompt validated during testing (voice profiling
first, then segment assignment), extended with cross-chunk memory.

## Endpoints

### `POST /api/transcribe-chunk`
Multipart form data:
- `audio`: the audio chunk file (webm/opus from the frontend)
- `session_id`: string identifying the session

Response:
```json
{
  "voiceProfiles": [
    { "speaker": "Speaker 1", "genderEstimate": "female", "pitch": "medium", "pace": "medium", "distinguishingQuality": "clear" }
  ],
  "segments": [
    { "speaker": "Speaker 1", "language": "si", "startTime": "00:00", "endTime": "00:08", "text": "..." }
  ]
}
```

### `GET /health`
Basic health check for Railway/uptime monitoring.

## Local setup

```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
```

Open `.env` and set your real key:
```
GEMINI_API_KEY=your_actual_key_here
ALLOWED_ORIGINS=http://localhost:5173
```

Then just run:
```bash
uvicorn main:app --reload --port 8000
```

The `.env` file is loaded automatically at startup (via `python-dotenv`) —
no need to set environment variables manually in your terminal each time.
This works the same way on Windows PowerShell, Mac, and Linux.

## Environment variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key from AI Studio |
| `ALLOWED_ORIGINS` | Comma-separated list of frontend origins allowed via CORS |
| `PORT` | Set automatically by Railway; defaults to 8000 locally |

## Deploying to Railway

1. Push this `backend/` folder as its own Railway service (Railway auto-
   detects the `Dockerfile`).
2. Set `GEMINI_API_KEY` and `ALLOWED_ORIGINS` (your deployed frontend URL)
   in Railway's **Variables** tab for this service — Railway injects these
   directly at runtime, so you do NOT need (and should NOT commit) a
   `.env` file for production. The `.env` file is for local development
   only, and is already excluded via `.gitignore`.
3. Railway assigns a public URL — set that as `VITE_API_URL` in the
   frontend's environment variables.

## Known limitations (POC stage)

- **In-memory session state**: sessions are lost on backend restart. Fine
  for a live demo/POC; move to Redis if you need durability across
  restarts or multiple backend instances.
- **Growing prompt size**: every chunk re-sends reference audio for every
  known speaker. For a small courtroom (4-6 recurring speakers) this is
  fine; for very long sessions with many speakers, consider capping how
  many reference speakers are sent or summarizing older ones.
- **Rate limits**: Gemini 3.1 Flash-Lite free tier has RPM/RPD limits (see
  AI Studio dashboard for current values). Long continuous sessions may
  need backoff/queueing logic added here if you hit them.
