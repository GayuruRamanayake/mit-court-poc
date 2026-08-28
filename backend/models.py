"""
Data models for the transcription session state and Gemini responses.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional
import time

LanguageCode = Literal["si", "ta", "en", "unknown"]
GenderEstimate = Literal["male", "female", "unclear"]
PitchLevel = Literal["low", "medium", "high"]
PaceLevel = Literal["slow", "medium", "fast"]


@dataclass
class VoiceProfile:
    speaker: str
    gender_estimate: GenderEstimate
    pitch: PitchLevel
    pace: PaceLevel
    distinguishing_quality: str
    # A short reference audio clip (raw bytes) used to help Gemini match
    # this speaker's voice in future chunks. Kept small (a few seconds).
    reference_audio: Optional[bytes] = None
    reference_mime_type: str = "audio/webm"

    def to_public_dict(self) -> dict:
        """Serializable version without the raw audio bytes."""
        return {
            "speaker": self.speaker,
            "genderEstimate": self.gender_estimate,
            "pitch": self.pitch,
            "pace": self.pace,
            "distinguishingQuality": self.distinguishing_quality,
        }


@dataclass
class TranscriptSegment:
    speaker: str
    language: LanguageCode
    start_time: str
    end_time: str
    text: str
    confidence: str = "high"

    def to_public_dict(self) -> dict:
        return {
            "speaker": self.speaker,
            "language": self.language,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "text": self.text,
            "confidence": self.confidence,
        }


@dataclass
class SessionState:
    session_id: str
    voice_profiles: dict[str, VoiceProfile] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    last_active_at: float = field(default_factory=time.time)

    def touch(self):
        self.last_active_at = time.time()

    def next_speaker_label(self) -> str:
        n = len(self.voice_profiles) + 1
        return f"Speaker {n}"