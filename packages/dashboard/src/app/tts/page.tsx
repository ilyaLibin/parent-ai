'use client';

import { useState, useRef, useCallback } from 'react';

const VOICES = [
  { group: 'American English (F)', voices: ['af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky'] },
  { group: 'American English (M)', voices: ['am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa'] },
  { group: 'British English (F)', voices: ['bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily'] },
  { group: 'British English (M)', voices: ['bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'] },
];

const ALL_VOICES = VOICES.flatMap(g => g.voices);
const SAMPLE_RATE = 24000;

interface SpokenChunk {
  text: string;
  voice: string;
  startTime: number;
  duration: number;
}

interface Segment {
  text: string;
  voice: string;
}

function VoiceSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {VOICES.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.voices.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function TTSPage() {
  const [multiVoice, setMultiVoice] = useState(false);

  // Single voice state
  const [text, setText] = useState('Hello, this is a test of the Kokoro text to speech system. It supports streaming audio generation.');
  const [voice, setVoice] = useState('af_heart');

  // Multi-voice state
  const [segments, setSegments] = useState<Segment[]>([
    { text: 'Hey, how are you doing today?', voice: 'af_heart' },
    { text: 'I am doing great, thanks for asking!', voice: 'am_adam' },
  ]);

  const [speed, setSpeed] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'wav' | 'stream'>('stream');
  const [status, setStatus] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Stream mode state
  const [spokenChunks, setSpokenChunks] = useState<SpokenChunk[]>([]);
  const [activeChunk, setActiveChunk] = useState(-1);
  const activeTimerRef = useRef<number[]>([]);

  const updateSegment = (index: number, field: keyof Segment, value: string) => {
    setSegments(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const addSegment = () => {
    const lastVoice = segments[segments.length - 1]?.voice || 'af_heart';
    // Pick a different voice for variety
    const nextVoice = lastVoice.startsWith('af_') ? 'am_adam' : 'af_heart';
    setSegments(prev => [...prev, { text: '', voice: nextVoice }]);
  };

  const removeSegment = (index: number) => {
    if (segments.length <= 1) return;
    setSegments(prev => prev.filter((_, i) => i !== index));
  };

  const buildBody = () => {
    if (multiVoice) {
      return { segments: segments.filter(s => s.text.trim()), speed };
    }
    return { text, voice, speed };
  };

  const hasText = multiVoice ? segments.some(s => s.text.trim()) : text.trim();

  const generateWav = async () => {
    setLoading(true);
    setStatus('Generating...');
    if (audioUrl) URL.revokeObjectURL(audioUrl);

    try {
      const res = await fetch(`/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });

      if (!res.ok) {
        const err = await res.json();
        setStatus(`Error: ${err.error}`);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setStatus('Ready');

      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
      }
    } catch (e) {
      setStatus('Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const generateStream = useCallback(async () => {
    setLoading(true);
    setStatus('Streaming...');
    setSpokenChunks([]);
    setActiveChunk(-1);
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }
    activeTimerRef.current.forEach(clearTimeout);
    activeTimerRef.current = [];

    try {
      const res = await fetch(`/api/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });

      if (!res.ok) {
        const err = await res.json();
        setStatus(`Error: ${err.error}`);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { setStatus('No stream'); setLoading(false); return; }

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      let scheduledTime = ctx.currentTime + 0.05;
      let chunkIndex = 0;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.done) break;

          // Decode base64 PCM16 to float32
          const raw = atob(msg.audio);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          const int16 = new Int16Array(bytes.buffer);
          const float32 = new Float32Array(int16.length);
          for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

          // Schedule audio playback
          const audioBuf = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
          audioBuf.getChannelData(0).set(float32);
          const source = ctx.createBufferSource();
          source.buffer = audioBuf;
          source.connect(ctx.destination);
          const startTime = Math.max(scheduledTime, ctx.currentTime);
          source.start(startTime);

          const duration = audioBuf.duration;
          const chunkData: SpokenChunk = { text: msg.text, voice: msg.voice || '', startTime, duration };

          setSpokenChunks(prev => [...prev, chunkData]);

          const delayMs = (startTime - ctx.currentTime) * 1000;
          const idx = chunkIndex;
          const timerId = window.setTimeout(() => setActiveChunk(idx), Math.max(0, delayMs));
          activeTimerRef.current.push(timerId);

          const endTimerId = window.setTimeout(() => {
            setActiveChunk(prev => prev === idx ? -1 : prev);
          }, Math.max(0, delayMs + duration * 1000));
          activeTimerRef.current.push(endTimerId);

          scheduledTime = startTime + duration;
          chunkIndex++;
        }
      }

      setStatus('Done');
    } catch (e) {
      setStatus('Stream failed');
    } finally {
      setLoading(false);
    }
  }, [text, voice, speed, audioUrl, multiVoice, segments]);

  const generate = () => {
    if (!hasText) return;
    if (mode === 'wav') generateWav();
    else generateStream();
  };

  // Color mapping for voices in multi-voice stream display
  const voiceColors: Record<string, string> = {};
  const colorClasses = ['text-blue-400', 'text-emerald-400', 'text-amber-400', 'text-rose-400', 'text-purple-400', 'text-cyan-400'];
  let colorIdx = 0;
  const getVoiceColor = (v: string) => {
    if (!voiceColors[v]) {
      voiceColors[v] = colorClasses[colorIdx % colorClasses.length];
      colorIdx++;
    }
    return voiceColors[v];
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-lg font-bold mb-6">/tts</h1>

      <div className="card-raised rounded-lg p-5 space-y-4">
        {/* Mode toggle: single vs multi-voice */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMultiVoice(false)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${!multiVoice ? 'bg-accent text-white' : 'bg-surface-2 text-fg-muted'}`}
          >
            Single voice
          </button>
          <button
            onClick={() => setMultiVoice(true)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${multiVoice ? 'bg-accent text-white' : 'bg-surface-2 text-fg-muted'}`}
          >
            Multi-voice
          </button>
        </div>

        {/* Single voice input */}
        {!multiVoice && (
          <>
            <div>
              <label className="block text-xs text-fg-secondary mb-1">Text</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="w-full input-inset rounded px-3 py-2 text-sm resize-y"
                placeholder="Enter text to synthesize..."
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-fg-secondary mb-1">Voice</label>
                <VoiceSelect value={voice} onChange={setVoice} className="w-full input-inset rounded px-3 py-2 text-sm" />
              </div>
            </div>
          </>
        )}

        {/* Multi-voice segments */}
        {multiVoice && (
          <div className="space-y-3">
            <label className="block text-xs text-fg-secondary">Segments</label>
            {segments.map((seg, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1 space-y-1">
                  <div className="flex gap-2">
                    <VoiceSelect
                      value={seg.voice}
                      onChange={(v) => updateSegment(i, 'voice', v)}
                      className="input-inset rounded px-2 py-1.5 text-xs w-40"
                    />
                    {segments.length > 1 && (
                      <button
                        onClick={() => removeSegment(i)}
                        className="text-fg-muted hover:text-red-400 text-xs px-1"
                        title="Remove segment"
                      >
                        x
                      </button>
                    )}
                  </div>
                  <textarea
                    value={seg.text}
                    onChange={(e) => updateSegment(i, 'text', e.target.value)}
                    rows={2}
                    className="w-full input-inset rounded px-3 py-2 text-sm resize-y"
                    placeholder={`Segment ${i + 1} text...`}
                  />
                </div>
              </div>
            ))}
            <button
              onClick={addSegment}
              className="text-xs text-accent hover:underline"
            >
              + Add segment
            </button>
          </div>
        )}

        {/* Speed, mode, generate */}
        <div className="flex gap-3 items-end">
          <div className="w-24">
            <label className="block text-xs text-fg-secondary mb-1">Speed</label>
            <input
              type="number"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value) || 1)}
              min={0.5}
              max={2.0}
              step={0.1}
              className="w-full input-inset rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="w-28">
            <label className="block text-xs text-fg-secondary mb-1">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'wav' | 'stream')}
              className="w-full input-inset rounded px-3 py-2 text-sm"
            >
              <option value="stream">Stream</option>
              <option value="wav">WAV</option>
            </select>
          </div>

          <button
            onClick={generate}
            disabled={loading || !hasText}
            className="btn-accent rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Speak'}
          </button>
          {status && <span className="text-xs text-fg-muted self-center">{status}</span>}
        </div>

        {/* WAV mode: audio player */}
        {audioUrl && mode === 'wav' && (
          <div className="pt-2">
            <audio ref={audioRef} controls className="w-full" src={audioUrl} />
          </div>
        )}

        {/* Stream mode: live text display */}
        {mode === 'stream' && spokenChunks.length > 0 && (
          <div className="pt-2 text-sm leading-relaxed">
            {spokenChunks.map((chunk, i) => {
              const isMulti = multiVoice || new Set(spokenChunks.map(c => c.voice)).size > 1;
              const baseClass = isMulti ? getVoiceColor(chunk.voice) : '';
              return (
                <span
                  key={i}
                  className={`transition-colors duration-200 ${
                    i === activeChunk
                      ? isMulti ? `${baseClass} font-medium brightness-125` : 'text-accent font-medium'
                      : i < activeChunk
                      ? isMulti ? baseClass : 'text-fg'
                      : 'text-fg-muted'
                  }`}
                >
                  {chunk.text}{' '}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-fg-muted space-y-1">
        <p>Engine: Kokoro 82M | Sample rate: 24kHz | {ALL_VOICES.length} voices</p>
        <p>Stream mode plays audio and highlights text as it speaks. WAV mode downloads full audio first.</p>
        <p>Multi-voice sends segments array — each segment gets its own voice.</p>
      </div>
    </div>
  );
}
