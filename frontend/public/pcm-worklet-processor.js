// AudioWorklet processor for capturing mic audio and converting it to raw
// 16kHz/16-bit PCM, matching what Azure Speech expects.
//
// This runs on a dedicated, real-time-priority audio thread separate from
// the browser's main thread - unlike the old ScriptProcessorNode approach,
// this can't be delayed or glitched by React re-renders, other tabs, or
// general main-thread busyness. That matters here because any dropped or
// corrupted audio samples feed directly into Azure's diarization/
// recognition engine and can degrade accuracy in ways that are hard to
// diagnose after the fact.

const TARGET_SAMPLE_RATE = 16000;

class PCMWorkletProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0]; // mono
    if (!channelData || channelData.length === 0) return true;

    const downsampled = this.downsampleTo16k(channelData, sampleRate);
    const pcm16Buffer = this.floatTo16BitPCM(downsampled);

    // Transfer the underlying buffer (not copy) for efficiency.
    this.port.postMessage(pcm16Buffer, [pcm16Buffer]);

    return true;
  }

  downsampleTo16k(input, inputSampleRate) {
    if (inputSampleRate === TARGET_SAMPLE_RATE) return input;

    const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < input.length; j++) {
        sum += input[j];
        count++;
      }
      output[i] = count > 0 ? sum / count : 0;
    }

    return output;
  }

  floatTo16BitPCM(input) {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }
}

registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);