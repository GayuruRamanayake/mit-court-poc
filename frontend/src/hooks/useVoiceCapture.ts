import { useCallback, useRef, useState } from 'react';

interface UseVoiceCaptureOptions {
  /** RMS energy level below which audio is considered silence (0-1 range) */
  silenceThreshold?: number;
  /** How long silence must persist before a chunk is finalized (ms) */
  silenceDurationMs?: number;
  /** Minimum chunk length before we'll even consider cutting it (ms) */
  minChunkMs?: number;
  /** Hard cap so a chunk never grows unbounded if someone talks non-stop (ms) */
  maxChunkMs?: number;
  onChunkReady: (blob: Blob) => void;
}

/**
 * Captures microphone audio continuously and uses simple RMS-energy-based
 * voice activity detection to cut it into speech chunks on natural pauses.
 * This avoids pulling in a heavy ONNX-based VAD model for the POC — energy
 * thresholding is sufficient for reasonably clean courtroom mic audio.
 */
export function useVoiceCapture({
  silenceThreshold = 0.02,
  silenceDurationMs = 1200,
  minChunkMs = 2000,
  maxChunkMs = 30000,
  onChunkReady,
}: UseVoiceCaptureOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeechActive, setIsSpeechActive] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunkStartRef = useRef<number>(0);
  const silenceStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const finalizeChunk = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    recorderRef.current.stop();
  }, []);

  const startNewRecorder = useCallback(() => {
    if (!streamRef.current) return;
    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: 'audio/webm;codecs=opus',
    });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (blob.size > 0) onChunkReady(blob);
      // Immediately start listening for the next chunk
      chunkStartRef.current = Date.now();
      silenceStartRef.current = null;
      startNewRecorder();
    };

    recorder.start();
    recorderRef.current = recorder;
    chunkStartRef.current = Date.now();
  }, [onChunkReady]);

  const monitorLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    // Compute RMS energy (0-1 range)
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / data.length);

    const now = Date.now();
    const chunkAge = now - chunkStartRef.current;
    const speaking = rms > silenceThreshold;
    setIsSpeechActive(speaking);

    if (speaking) {
      silenceStartRef.current = null;
    } else {
      if (silenceStartRef.current === null) silenceStartRef.current = now;
      const silenceDuration = now - silenceStartRef.current;

      if (silenceDuration >= silenceDurationMs && chunkAge >= minChunkMs) {
        finalizeChunk();
      }
    }

    // Hard cap: force-cut very long continuous speech
    if (chunkAge >= maxChunkMs) {
      finalizeChunk();
    }

    rafRef.current = requestAnimationFrame(monitorLoop);
  }, [silenceThreshold, silenceDurationMs, minChunkMs, maxChunkMs, finalizeChunk]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;

    startNewRecorder();
    setIsListening(true);
    rafRef.current = requestAnimationFrame(monitorLoop);
  }, [startNewRecorder, monitorLoop]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null; // prevent restarting a new recorder
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();

    streamRef.current = null;
    audioContextRef.current = null;
    recorderRef.current = null;
    analyserRef.current = null;
    setIsListening(false);
    setIsSpeechActive(false);
  }, []);

  return { isListening, isSpeechActive, start, stop };
}
