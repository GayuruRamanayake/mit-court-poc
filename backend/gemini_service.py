"""
Gemini transcription + diarization service.

Implements the two-stage prompt validated during POC testing:
  Stage 1 - voice profiling (gender/pitch/pace estimate per distinct voice)
  Stage 2 - segment assignment (transcribe + tag language + match to a profile)

Cross-chunk speaker matching: known speaker profiles from earlier chunks
in a session are passed as TEXT descriptions only (gender/pitch/pace).
An earlier version of this service also attached short reference audio
clips per known speaker to help the model compare voices directly, but
this was removed after testing showed the model would sometimes
re-transcribe that reference audio's content into new segments despite
explicit instructions not to - causing duplicated/fabricated-looking
content in the live transcript. Text-only matching is a weaker signal for
cross-chunk speaker continuity, but eliminates that failure mode, which
is more important for a transcript intended as a legal record.
"""
from __future__ import annotations
import json
import logging
from typing import Optional

from google import genai
from google.genai import types

from models import VoiceProfile, TranscriptSegment

logger = logging.getLogger("gemini_service")

MODEL_NAME = "gemini-3.1-flash-lite"

BASE_INSTRUCTIONS = """
You are transcribing audio that may contain Sinhala, Tamil, and English,
sometimes switching between languages mid-conversation, and multiple
speakers. Do not assume anything about the setting, context, or subject
matter of this audio beyond what you can directly hear.

CRITICAL GROUND RULE - READ THIS FIRST:
This transcript may be used as a legal record. Fabricating content that
was not actually spoken is a SEVERE error - far worse than leaving a gap.
If you are not genuinely confident about what was said in a segment, you
MUST mark it as "[inaudible]" rather than producing plausible-sounding
text. Never invent dialogue, never complete a sentence based on what
"probably" was said, and never fill silence or unclear audio with
generic or textbook-sounding content. Under-transcribing is acceptable.
Fabricating is not.

You MUST complete this in three explicit stages. Do not skip any stage.

STAGE 1 - VOICE PROFILING (do this first, before any transcription):
Listen to the NEW audio clip provided (labeled "AUDIO TO PROCESS" below)
start to finish. Identify every acoustically distinct voice ACTUALLY
PRESENT in it. Do not assume a certain number of speakers - count only
voices you can genuinely hear.

{known_speakers_block}

For each voice in the new audio, decide: does it plausibly match one of
the KNOWN SPEAKERS above based on their text profile (gender, pitch,
pace, distinguishing quality), or is it a genuinely new voice not heard
before in this session?
  - If it plausibly matches a known speaker's profile, reuse that EXACT
    speaker label.
  - If it's new, assign the next available label and write a fresh profile
    for it: estimated gender (male/female/unclear), pitch register
    (low/medium/high), pace (slow/medium/fast), and a distinguishing
    quality (e.g. raspy, nasal, deep, breathy, clear).

Base all of this ONLY on how the voice physically sounds. Do NOT use
language, topic, or sentence content as a signal for speaker identity.
A pause, a new sentence, or a topic change is NEVER evidence of a new
speaker. Two different speakers may speak the same language, and one
speaker may switch languages mid-recording.

If two people are speaking AT THE SAME TIME (overlapping/crosstalk), do
NOT arbitrarily assign that segment to just one of them. Mark it as
"[crosstalk]" in the text field instead of guessing which person's words
you're transcribing.

STAGE 2 - SEGMENT ASSIGNMENT:
Go through the NEW audio chronologically. For each segment of speech,
assign it to a speaker label (from Stage 1 - either a known speaker or a
newly-created one). Transcribe and tag language independently per segment.
Only transcribe audio that actually contains speech - do not produce a
segment for silence, background noise, or a pause.

STAGE 3 - SELF-VERIFICATION (mandatory before returning your answer):
Re-read every segment you produced and check for these specific warning
signs of fabrication:
  (a) Does any segment repeat a phrase nearly identical to another
      segment elsewhere in this transcript, without clear reason (e.g.
      someone genuinely repeating themselves)? If so, re-listen to both
      moments - if you cannot verify both are real, replace the less
      certain one with "[inaudible]".
  (b) Does any segment sound like a generic definition, textbook
      explanation, or meta-commentary (e.g. explaining what a technical
      term means, or asking what language is being spoken) that seems
      disconnected from the natural flow of this specific conversation?
      If so, it is very likely fabricated - replace it with
      "[inaudible]" unless you are highly confident it was genuinely said.
  (c) Would a human reviewer, listening to this exact audio, be
      surprised by any segment because it doesn't match what they'd
      expect to hear? If you can't confidently defend a segment as
      something you actually heard, remove the guess and mark it
      "[inaudible]".
Only after this check should you finalize your output.

Return ONLY valid JSON (no markdown, no preamble) matching this exact
structure:

{{
  "voice_profiles": [
    {{
      "speaker": "Speaker 1",
      "gender_estimate": "male" | "female" | "unclear",
      "pitch": "low" | "medium" | "high",
      "pace": "slow" | "medium" | "fast",
      "distinguishing_quality": "short description",
      "is_new": true
    }}
  ],
  "segments": [
    {{
      "speaker": "Speaker 1",
      "language": "si" | "ta" | "en",
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "text": "transcribed text in original script (Sinhala/Tamil script or English)",
      "confidence": "high" | "low"
    }}
  ]
}}

Rules:
- "voice_profiles" should only include NEW speakers discovered in this
  chunk (set "is_new": true). If every speaker in this chunk was already
  known, return an empty voice_profiles array.
- The "speaker" field in every segment MUST be either a known speaker
  label or one of the newly defined labels in voice_profiles.
- Only assign a NEW label if the voice's estimated gender/pitch/pace
  genuinely doesn't match any known speaker's profile. When in doubt,
  prefer matching an existing known speaker over creating a new one.
- Transcribe in the original script (native Sinhala/Tamil script, not
  transliteration), unless the speech is in English.
- Do not translate - transcribe only.
- If speakers overlap, mark text as "[crosstalk]". If audio is unclear
  or you are not confident, mark text as "[inaudible]". Never guess.
- Set "confidence" to "low" for any segment where you have even mild
  uncertainty about the exact wording, even if you didn't mark it
  "[inaudible]" outright. Reserve "high" only for segments you would
  confidently defend word-for-word if challenged. When unsure whether to
  mark something "low", mark it "low" - this is a safety flag for human
  review, not a judgment of overall transcript quality.
- Timestamps are relative to the start of the NEW audio clip only (i.e.
  00:00 is the start of this chunk, not the whole session).
"""


def _build_known_speakers_block(profiles: dict[str, VoiceProfile]) -> str:
    if not profiles:
        return (
            "KNOWN SPEAKERS: none yet - this is the first chunk of the "
            "session. Every distinct voice you hear is new."
        )

    lines = ["KNOWN SPEAKERS FROM EARLIER IN THIS SESSION (reference audio "
             "for each is attached before the new audio clip):"]
    for p in profiles.values():
        lines.append(
            f"  - {p.speaker}: {p.gender_estimate} voice, {p.pitch} pitch, "
            f"{p.pace} pace, {p.distinguishing_quality}"
        )
    return "\n".join(lines)


class GeminiDiarizationService:
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)

    def process_chunk(
        self,
        audio_bytes: bytes,
        mime_type: str,
        known_profiles: dict[str, VoiceProfile],
    ) -> tuple[list[VoiceProfile], list[TranscriptSegment]]:
        """
        Sends the new audio chunk to Gemini, along with reference audio for
        any previously known speakers in this session, and returns the
        newly-discovered voice profiles plus the transcribed segments.
        """
        known_block = _build_known_speakers_block(known_profiles)
        prompt_text = BASE_INSTRUCTIONS.format(known_speakers_block=known_block)

        contents: list = []

        # NOTE: We deliberately do NOT attach reference audio clips for
        # known speakers here, even though that was the original design.
        # In testing, the model repeatedly re-transcribed reference audio
        # content into new segments despite explicit instructions not to -
        # even with short, properly-trimmed clips. Since duplicated/
        # fabricated transcript content is a more serious problem than
        # slightly weaker cross-chunk speaker matching, we now rely on
        # TEXT-ONLY profile descriptions (gender/pitch/pace) for matching
        # known speakers, and skip sending any audio that isn't the
        # current chunk.

        contents.append(
            "[AUDIO TO PROCESS - this is the ONLY audio in this request, "
            "transcribe everything you hear in it]:"
        )
        contents.append(types.Part.from_bytes(data=audio_bytes, mime_type=mime_type))
        contents.append(prompt_text)

        response = self.client.models.generate_content(
            model=MODEL_NAME,
            contents=contents,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )

        raw = response.text.strip()
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            logger.error("Gemini returned non-JSON output: %s", raw[:500])
            raise ValueError("Model did not return valid JSON")

        new_profiles = [
            VoiceProfile(
                speaker=p["speaker"],
                gender_estimate=p["gender_estimate"],
                pitch=p["pitch"],
                pace=p["pace"],
                distinguishing_quality=p.get("distinguishing_quality", ""),
            )
            for p in parsed.get("voice_profiles", [])
        ]

        segments = [
            TranscriptSegment(
                speaker=s["speaker"],
                language=s.get("language", "unknown"),
                start_time=s.get("start_time", "00:00"),
                end_time=s.get("end_time", "00:00"),
                text=s.get("text", ""),
                confidence=s.get("confidence", "low"),
            )
            for s in parsed.get("segments", [])
        ]

        return new_profiles, segments