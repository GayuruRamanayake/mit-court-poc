"""
FastAPI backend for the multilingual court transcription POC.

Architecture (Azure version): the frontend opens a WebSocket and streams
raw PCM audio continuously. That audio is fed into ONE persistent Azure
ConversationTranscriber session for the connection's lifetime. Recognized
segments are pushed back over the same WebSocket the moment Azure produces
them - no chunking, no waiting, no per-request round trips.

Session history is persisted server-side in Postgres (see database.py),
so past transcripts survive browser refreshes/device changes, not just
localStorage.

Endpoints:
  WS     /ws/transcribe/{session_id}  - stream audio in, receive segments out
  GET    /health                      - basic health check (useful for Railway)
  POST   /api/sessions                - save/update a session (autosave)
  GET    /api/sessions                - list saved sessions (summaries only)
  GET    /api/sessions/{session_id}   - fetch one full session
  DELETE /api/sessions/{session_id}   - delete a session
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
from typing import Any

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from azure_speech_service import AzureLiveSession
import database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

AZURE_SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY")
AZURE_SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION")

if not AZURE_SPEECH_KEY or not AZURE_SPEECH_REGION:
    raise RuntimeError(
        "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables must both be set"
    )

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app = FastAPI(title="Court Transcription POC Backend (Azure Speech)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    database.init_db()


class SessionSavePayload(BaseModel):
    session_id: str
    started_at: int
    segments: list[dict[str, Any]]
    speaker_names: dict[str, str]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/sessions")
def save_session(payload: SessionSavePayload):
    try:
        database.upsert_session(
            payload.session_id, payload.started_at, payload.segments, payload.speaker_names
        )
        return {"status": "ok"}
    except Exception:
        logger.exception("Failed to save session %s", payload.session_id)
        raise HTTPException(status_code=500, detail="Failed to save session")


@app.get("/api/sessions")
def list_sessions():
    try:
        return database.list_sessions()
    except Exception:
        logger.exception("Failed to list sessions")
        raise HTTPException(status_code=500, detail="Failed to list sessions")


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    session = database.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    try:
        database.delete_session(session_id)
        return {"status": "ok"}
    except Exception:
        logger.exception("Failed to delete session %s", session_id)
        raise HTTPException(status_code=500, detail="Failed to delete session")


@app.websocket("/ws/transcribe/{session_id}")
async def websocket_transcribe(websocket: WebSocket, session_id: str):
    await websocket.accept()
    loop = asyncio.get_event_loop()

    def on_segment(segment: dict):
        # This callback fires from Azure SDK's own background thread, not
        # the asyncio event loop - route it back onto the loop safely.
        try:
            asyncio.run_coroutine_threadsafe(
                websocket.send_text(json.dumps(segment)), loop
            )
        except Exception:
            logger.exception("Failed to forward segment to client for session %s", session_id)

    session = AzureLiveSession(
        key=AZURE_SPEECH_KEY,
        region=AZURE_SPEECH_REGION,
        on_segment=on_segment,
    )
    session.start()
    logger.info("Started Azure live session for %s", session_id)

    try:
        while True:
            data = await websocket.receive_bytes()
            session.write_audio(data)
    except WebSocketDisconnect:
        logger.info("Client disconnected for session %s", session_id)
    except Exception:
        logger.exception("Unexpected error in session %s", session_id)
    finally:
        session.stop()