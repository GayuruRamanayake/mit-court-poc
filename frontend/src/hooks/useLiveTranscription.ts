import { useCallback, useRef, useState } from 'react';

export interface FinalSegment {
  type: 'final';
  speaker: string;
  language: string;
  text: string;
  offset_sec: number;
  duration_sec: number;
  confidence: 'high' | 'low';
}

export interface InterimSegment {
  type: 'interim';
  text: string;
}

export type IncomingMessage = FinalSegment | InterimSegment;

interface UseLiveTranscriptionOptions {
  wsUrl: string;
  onFinalSegment: (segment: FinalSegment) => void;
  onInterim: (text: string) => void;
  onError?: (message: string) => void;
  onConnectionLost?: () => void;
}

/**
 * Captures microphone audio, converts it to raw 16kHz/16-bit PCM (what
 * Azure Speech expects), and streams it continuously over a WebSocket.
 *
 * Audio conversion happens inside an AudioWorklet (see
 * public/pcm-worklet-processor.js), which runs on a dedicated real-time
 * audio thread - separate from React's main thread, so heavy re-renders
 * or other browser activity can't introduce glitches or dropped samples
 * into the audio actually sent to Azure. The previous ScriptProcessorNode
 * approach ran on the main thread and was vulnerable to exactly that.
 *
 * We deliberately do NOT use MediaRecorder + webm here (like the old
 * Gemini-based hook did) - webm/opus chunks from MediaRecorder's
 * timeslice mode aren't independently decodable fragments, which makes
 * them a poor fit for continuous server-side streaming.
 */
export function useLiveTranscription({
  wsUrl,
  onFinalSegment,
  onInterim,
  onError,
  onConnectionLost,
}: UseLiveTranscriptionOptions) {
  const [isListening, setIsListening] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intentionalStopRef = useRef(false);

  const start = useCallback(async () => {
    intentionalStopRef.current = false;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const message: IncomingMessage = JSON.parse(event.data);
        if (message.type === 'interim') {
          onInterim(message.text);
        } else if (message.type === 'final') {
          onFinalSegment(message);
        }
      } catch {
        // ignore malformed/non-JSON messages
      }
    };

    ws.onerror = () => {
      onError?.('WebSocket connection error');
    };

    ws.onclose = () => {
      // Only treat this as a problem if WE didn't ask for the connection
      // to close - an unexpected close (network drop, backend crash,
      // Azure session error) should surface clearly rather than silently
      // leaving the UI in a "still listening" state that isn't true.
      if (!intentionalStopRef.current) {
        setIsListening(false);
        onConnectionLost?.();
      }
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      const failTimer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 8000);
      ws.addEventListener('open', () => clearTimeout(failTimer), { once: true });
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    await audioContext.audioWorklet.addModule('/pcm-worklet-processor.js');

    const source = audioContext.createMediaStreamSource(stream);
    sourceRef.current = source;

    const workletNode = new AudioWorkletNode(audioContext, 'pcm-worklet-processor');
    workletNodeRef.current = workletNode;

    workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(event.data);
      }
    };

    source.connect(workletNode);
    workletNode.connect(audioContext.destination);

    setIsListening(true);
  }, [wsUrl, onFinalSegment, onInterim, onError, onConnectionLost]);

  const stop = useCallback(() => {
    intentionalStopRef.current = true;

    workletNodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioContextRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();

    workletNodeRef.current = null;
    sourceRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    wsRef.current = null;
    setIsListening(false);
  }, []);

  return { isListening, start, stop };
}