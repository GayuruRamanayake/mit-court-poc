"""
Azure Speech real-time diarization service.

Maintains ONE persistent ConversationTranscriber per live session, fed via
a PushAudioInputStream. Because the whole session uses a single continuous
Azure transcriber (not a fresh one per chunk, like our old Gemini setup),
speaker labels (Guest-1, Guest-2, ...) stay consistent for the entire
session automatically - Azure does real acoustic speaker clustering across
the full audio stream, so we no longer need our own cross-chunk speaker-
matching logic (the old speaker_matching.py is no longer needed).
"""
from __future__ import annotations
import json
import logging
import threading
from typing import Callable, Optional

import os

import azure.cognitiveservices.speech as speechsdk

logger = logging.getLogger("azure_speech_service")

CANDIDATE_LANGUAGES = ["en-US", "si-LK", "ta-IN"]
SAMPLE_RATE = 16000
BITS_PER_SAMPLE = 16
CHANNELS = 1

# How long a silence gap must last before Azure finalizes the current
# utterance as a complete segment. This is a genuine trade-off, not a
# "bigger is better" setting:
#   - TOO LONG: a natural pause between two sentences spoken in DIFFERENT
#     languages might not be long enough to trigger a cut, so both
#     sentences get merged into one segment and Azure has to pick a
#     single language for both - breaking between-sentence code-switching.
#   - TOO SHORT: normal mid-sentence pauses (thinking, checking a
#     document) get treated as sentence boundaries, fragmenting a single
#     thought into multiple segments unnecessarily.
# Configurable via env var specifically so this can be A/B tested against
# real bilingual recordings without a code change or redeploy each time.
SEGMENTATION_SILENCE_TIMEOUT_MS = int(os.environ.get("SEGMENTATION_SILENCE_TIMEOUT_MS", "500"))

# Words/names/terms that come up often in this specific context and are
# either uncommon enough that Azure's general-purpose model might mishear
# them, or specific enough (proper nouns, case-specific terminology) that
# there's no way for a general model to already know them. Boosting these
# increases the odds Azure recognizes them correctly rather than
# substituting a phonetically similar but wrong word/name.
#
# Add real names/terms relevant to your actual sessions here - this list
# is a starting example, not exhaustive.
PHRASE_LIST: list[str] = [
    # Example entries - replace with real recurring names/terms:
    # "Ranasinghe",
    # "case file",
    # "objection sustained",
]


class AzureLiveSession:
    """
    Wraps one continuous Azure diarization session. Audio is pushed in via
    write_audio() as raw 16kHz/16-bit/mono PCM bytes; recognized segments
    are delivered asynchronously to the on_segment callback as Azure
    produces them (not batched, not waiting for the whole recording).
    """

    def __init__(self, key: str, region: str, on_segment: Callable[[dict], None]):
        stream_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=SAMPLE_RATE,
            bits_per_sample=BITS_PER_SAMPLE,
            channels=CHANNELS,
        )
        self.push_stream = speechsdk.audio.PushAudioInputStream(stream_format=stream_format)
        audio_config = speechsdk.audio.AudioConfig(stream=self.push_stream)

        speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
        # Without this, Azure detects the language ONCE at the start and
        # assumes it stays constant - which broke on our multi-language
        # recordings that switch between Sinhala/Tamil/English mid-
        # conversation during testing.
        speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous"
        )
        # See SEGMENTATION_SILENCE_TIMEOUT_MS comment above for rationale.
        speech_config.set_property(
            speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
            str(SEGMENTATION_SILENCE_TIMEOUT_MS),
        )
        # Detailed output format exposes real acoustic confidence scores
        # (via the result's JSON payload) instead of us having to guess or
        # hardcode a confidence value - this is a genuine measured signal
        # from the recognition engine itself, unlike Gemini's self-reported
        # confidence field, which testing showed was unreliable.
        speech_config.output_format = speechsdk.OutputFormat.Detailed

        auto_detect_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
            languages=CANDIDATE_LANGUAGES
        )

        self.transcriber = speechsdk.transcription.ConversationTranscriber(
            speech_config=speech_config,
            audio_config=audio_config,
            auto_detect_source_language_config=auto_detect_config,
        )

        if PHRASE_LIST:
            phrase_list_grammar = speechsdk.PhraseListGrammar.from_recognizer(self.transcriber)
            for phrase in PHRASE_LIST:
                phrase_list_grammar.addPhrase(phrase)

        self.on_segment = on_segment
        self._stopped = threading.Event()

        self.transcriber.transcribed.connect(self._handle_transcribed)
        self.transcriber.transcribing.connect(self._handle_interim)
        self.transcriber.session_stopped.connect(self._handle_stopped)
        self.transcriber.canceled.connect(self._handle_stopped)

    def _handle_interim(self, evt):
        """
        Fires repeatedly with a GROWING, NOT-YET-FINAL guess while someone
        is still mid-utterance. Speaker/language/confidence aren't reliable
        yet at this stage (those firm up once Azure finalizes the segment),
        so we only forward the text itself, tagged as an interim preview -
        purely for a "live typing" feel in the UI, never treated as an
        authoritative transcript line.
        """
        text = evt.result.text.strip()
        self.on_segment({"type": "interim", "text": text})

    def _handle_transcribed(self, evt):
        text = evt.result.text.strip()
        if not text:
            return

        try:
            lang_result = speechsdk.AutoDetectSourceLanguageResult(evt.result)
            language = (lang_result.language or "unknown").split("-")[0]
        except Exception:
            language = "unknown"

        confidence_label = self._extract_confidence_label(evt.result)

        self.on_segment({
            "type": "final",
            "speaker": evt.result.speaker_id or "Unknown",
            "language": language,
            "text": text,
            "offset_sec": evt.result.offset / 10_000_000,  # ticks -> seconds
            "duration_sec": evt.result.duration / 10_000_000,
            "confidence": confidence_label,
        })

    @staticmethod
    def _extract_confidence_label(result) -> str:
        """
        Extracts Azure's real acoustic confidence score from the detailed
        JSON result and buckets it into "high"/"low" for the UI, instead of
        the self-reported (and, per testing, unreliable) confidence field
        Gemini used to provide. Defaults to "low" (the safe direction) if
        parsing fails for any reason - better to over-flag for review than
        silently trust a segment we couldn't actually verify.
        """
        try:
            detailed = json.loads(result.json)
            best = detailed.get("NBest", [{}])[0]
            score = best.get("Confidence")
            if score is None:
                return "low"
            return "high" if score >= 0.7 else "low"
        except Exception:
            logger.warning("Could not parse confidence from Azure result", exc_info=True)
            return "low"

    def _handle_stopped(self, evt):
        self._stopped.set()

    def start(self):
        self.transcriber.start_transcribing_async()

    def write_audio(self, pcm_bytes: bytes):
        if pcm_bytes:
            self.push_stream.write(pcm_bytes)

    def stop(self):
        try:
            self.push_stream.close()
            self.transcriber.stop_transcribing_async()
        except Exception:
            logger.exception("Error stopping Azure session")