"""
In-memory session registry.

For a POC, in-memory is fine (single backend instance, Railway service
doesn't need persistence across restarts for a live demo session). If this
grows beyond a POC, swap this for Redis so sessions survive backend
restarts and can be shared across multiple instances.
"""
from __future__ import annotations
import time
from threading import Lock

from models import SessionState, VoiceProfile

SESSION_TTL_SECONDS = 60 * 30  # drop sessions idle for 30+ minutes


class SessionRegistry:
    def __init__(self):
        self._sessions: dict[str, SessionState] = {}
        self._lock = Lock()

    def get_or_create(self, session_id: str) -> SessionState:
        with self._lock:
            self._evict_stale()
            if session_id not in self._sessions:
                self._sessions[session_id] = SessionState(session_id=session_id)
            session = self._sessions[session_id]
            session.touch()
            return session

    def register_new_speaker(
        self,
        session_id: str,
        profile: VoiceProfile,
        reference_audio: Optional[bytes],
        reference_mime_type: str,
    ):
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return
            # reference_audio may be None if trimming failed (e.g. ffmpeg
            # not installed) - in that case, register the profile WITHOUT
            # a voice reference rather than risk sending an untrimmed
            # full-length clip that could bleed into future transcripts.
            if reference_audio is not None:
                profile.reference_audio = reference_audio
                profile.reference_mime_type = reference_mime_type
            session.voice_profiles[profile.speaker] = profile

    def _evict_stale(self):
        now = time.time()
        stale_ids = [
            sid
            for sid, s in self._sessions.items()
            if now - s.last_active_at > SESSION_TTL_SECONDS
        ]
        for sid in stale_ids:
            del self._sessions[sid]


# Single shared instance for the app's lifetime
registry = SessionRegistry()