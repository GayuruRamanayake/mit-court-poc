"""
Small audio helpers - primarily used to trim a new speaker's full chunk
audio down to a short reference snippet (a few seconds) before storing it,
so the per-request payload doesn't grow unbounded as more speakers are
discovered across a session.
"""
from __future__ import annotations
import io
import logging
from typing import Optional

from pydub import AudioSegment

logger = logging.getLogger("audio_utils")

REFERENCE_SNIPPET_MS = 4000  # keep first 4 seconds as the voice reference


def trim_to_reference_snippet(audio_bytes: bytes, mime_type: str) -> Optional[bytes]:
    """
    Returns a short (~4s) trimmed clip from the start of the given audio,
    or None if trimming fails for any reason (e.g. ffmpeg not installed,
    unsupported format).

    IMPORTANT: this intentionally returns None on failure rather than the
    full untrimmed chunk. An earlier version fell back to storing the
    entire chunk as the "reference" audio, which caused the model to
    sometimes re-transcribe that reference audio's content as if it were
    new speech in later requests (since the reference clip could be up to
    30 seconds of real conversation instead of a short sample). Better to
    have no voice reference for a speaker (falls back to text-only
    profile matching) than to risk duplicate/bled-through transcript
    content.
    """
    try:
        fmt = "webm" if "webm" in mime_type else mime_type.split("/")[-1]
        audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=fmt)
        snippet = audio[:REFERENCE_SNIPPET_MS]
        out = io.BytesIO()
        snippet.export(out, format="webm", codec="libopus")
        return out.getvalue()
    except Exception:
        logger.warning(
            "Failed to trim reference audio (is ffmpeg installed and on "
            "PATH?) - proceeding WITHOUT a voice reference for this "
            "speaker rather than risking a full-length chunk bleeding "
            "into future transcripts.",
            exc_info=True,
        )
        return None