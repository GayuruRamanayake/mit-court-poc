"""
Azure Speech Diarization + Transcription Validation Script
------------------------------------------------------------
Tests Azure Speech's ConversationTranscriber (real acoustic diarization,
not an LLM) on the same audio clips we tested with Gemini, so we can
directly compare:
  1. Does it hallucinate/fabricate content? (expected: no, or far less)
  2. Does it correctly separate real speakers without exploding into
     phantom speakers?
  3. How well does it handle Sinhala / Tamil specifically?

SETUP:
1. pip install azure-cognitiveservices-speech
2. Set your credentials as environment variables:
   $env:AZURE_SPEECH_KEY="your_key_1_here"
   $env:AZURE_SPEECH_REGION="eastus"
3. Run: python test_azure_diarization.py your_audio_file.wav

NOTE: Azure Speech works best with WAV (16kHz, 16-bit, mono PCM). If your
file is mp3/webm, this script will attempt to convert it first using
pydub (which needs ffmpeg - same requirement as the backend).
"""

import os
import sys
import time
import io

import azure.cognitiveservices.speech as speechsdk
from pydub import AudioSegment

SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY")
SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION")

if not SPEECH_KEY or not SPEECH_REGION:
    raise SystemExit(
        "Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables first."
    )


def convert_to_wav(input_path: str) -> str:
    """Converts any audio file to 16kHz mono PCM WAV, which is what Azure
    Speech's ConversationTranscriber expects for best results."""
    ext = input_path.split(".")[-1].lower()
    if ext == "wav":
        return input_path

    print(f"Converting {ext} to WAV (16kHz mono)...")
    audio = AudioSegment.from_file(input_path, format=ext)
    audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)

    output_path = input_path.rsplit(".", 1)[0] + "_converted.wav"
    audio.export(output_path, format="wav")
    return output_path


def run_diarization(wav_path: str):
    speech_config = speechsdk.SpeechConfig(
        subscription=SPEECH_KEY, region=SPEECH_REGION
    )

    # By default, Azure only detects the spoken language ONCE at the start
    # of the audio and assumes it stays constant - which breaks on our
    # multi-language recordings that switch between Sinhala/Tamil/English
    # mid-conversation (this caused an English segment to be garbled as
    # phonetic Sinhala in initial testing). Continuous mode re-checks the
    # language throughout, at the cost of slightly higher latency.
    speech_config.set_property(
        speechsdk.PropertyId.SpeechServiceConnection_LanguageIdMode,
        "Continuous",
    )

    # Sinhala and Tamil locale hints - Azure needs explicit locale codes,
    # unlike Gemini's freeform language detection. Continuous LID supports
    # a max of 4 candidate languages.
    auto_detect_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
        languages=["en-US", "si-LK", "ta-IN"]
    )

    audio_config = speechsdk.audio.AudioConfig(filename=wav_path)

    conversation_transcriber = speechsdk.transcription.ConversationTranscriber(
        speech_config=speech_config,
        audio_config=audio_config,
        auto_detect_source_language_config=auto_detect_config,
    )

    results = []
    done = False

    def transcribed_cb(evt):
        if evt.result.text.strip():
            speaker_id = evt.result.speaker_id or "Unknown"
            results.append({
                "speaker": speaker_id,
                "text": evt.result.text,
                "offset_sec": evt.result.offset / 10_000_000,  # ticks -> seconds
                "duration_sec": evt.result.duration / 10_000_000,
            })
            print(f"[{speaker_id}] ({results[-1]['offset_sec']:.1f}s): {evt.result.text}")

    def stop_cb(evt):
        nonlocal done
        done = True

    conversation_transcriber.transcribed.connect(transcribed_cb)
    conversation_transcriber.session_stopped.connect(stop_cb)
    conversation_transcriber.canceled.connect(stop_cb)

    print(f"\nStarting transcription of: {wav_path}\n{'='*60}")
    conversation_transcriber.start_transcribing_async()

    while not done:
        time.sleep(0.5)

    conversation_transcriber.stop_transcribing_async()
    return results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_azure_diarization.py <path_to_audio_file>")
        sys.exit(1)

    input_file = sys.argv[1]
    if not os.path.exists(input_file):
        raise SystemExit(f"File not found: {input_file}")

    wav_file = convert_to_wav(input_file)
    results = run_diarization(wav_file)

    print(f"\n{'='*60}")
    print(f"Total segments: {len(results)}")
    unique_speakers = set(r["speaker"] for r in results)
    print(f"Unique speakers detected: {len(unique_speakers)} -> {unique_speakers}")
    print(f"{'='*60}")
    print("\nCompare against the Gemini results for:")
    print("  1. Any fabricated/hallucinated content not actually said")
    print("  2. Speaker count matching reality (no phantom speakers)")
    print("  3. Sinhala/Tamil transcription accuracy")