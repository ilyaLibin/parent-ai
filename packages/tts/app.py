import io
import os
import json
import base64
import time
import logging
import functools
import numpy as np
import soundfile as sf
from flask import Flask, request, Response, jsonify, stream_with_context
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from kokoro import KPipeline

app = Flask(__name__)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('tts')
CORS(app)

API_TOKEN = os.environ.get('TTS_API_TOKEN', '')

limiter = Limiter(get_remote_address, app=app, default_limits=[])

# Load pipeline once at startup
pipeline = KPipeline(lang_code='a')

SAMPLE_RATE = 24000
VOICES = [
    'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica',
    'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
    'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam',
    'am_michael', 'am_onyx', 'am_puck', 'am_santa',
    'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
    'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
]


def require_token(f):
    """Decorator that checks for valid Bearer token."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not API_TOKEN:
            return f(*args, **kwargs)
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer ') or auth[7:] != API_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


def to_numpy(audio):
    """Convert tensor or array to numpy."""
    if hasattr(audio, 'numpy'):
        return audio.numpy()
    return audio


def parse_segments():
    """Parse request into list of {text, voice} segments + speed.

    Accepts either:
      {"text": "...", "voice": "...", "speed": 1.0}
    or:
      {"segments": [{"text": "...", "voice": "..."}, ...], "speed": 1.0}
    """
    data = request.get_json(silent=True) or {}
    speed = float(data.get('speed', 1.0))

    if 'segments' in data:
        segments = data['segments']
        if not isinstance(segments, list) or not segments:
            return None, speed, 'segments must be a non-empty array'
        for seg in segments:
            if not seg.get('text'):
                return None, speed, 'each segment must have text'
            seg.setdefault('voice', 'af_heart')
            if seg['voice'] not in VOICES:
                return None, speed, f"Unknown voice: {seg['voice']}"
        return segments, speed, None
    else:
        text = data.get('text', '')
        voice = data.get('voice', 'af_heart')
        if not text:
            return None, speed, 'text is required'
        if voice not in VOICES:
            return None, speed, f'Unknown voice: {voice}'
        return [{'text': text, 'voice': voice}], speed, None


def text_preview(text, max_len=50):
    """Return first max_len chars of text for logging."""
    text = text.strip().replace('\n', ' ')
    return text[:max_len] + '...' if len(text) > max_len else text


def generate_chunks(text, voice, speed, split_pattern=r'[.!?]+'):
    """Run Kokoro pipeline and yield (graphemes, audio) tuples."""
    for gs, _ps, audio in pipeline(text, voice=voice, speed=speed, split_pattern=split_pattern):
        if audio is not None and len(audio) > 0:
            yield gs, to_numpy(audio)


def generate_all_segments(segments, speed):
    """Yield (graphemes, audio, voice) tuples across all segments."""
    for seg in segments:
        for gs, audio in generate_chunks(seg['text'], seg['voice'], speed):
            yield gs, audio, seg['voice']


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'engine': 'kokoro', 'sample_rate': SAMPLE_RATE})


@app.route('/voices', methods=['GET'])
@require_token
def voices():
    return jsonify(VOICES)


@app.route('/tts', methods=['GET', 'POST'])
@require_token
@limiter.limit('10/minute')
def tts():
    """Generate TTS audio, returns a complete WAV file.

    Accepts single or multi-voice:
      {"text": "...", "voice": "...", "speed": 1.0}
      {"segments": [{"text": "...", "voice": "..."}, ...], "speed": 1.0}
    """
    segments, speed, error = parse_segments()
    if error:
        logger.warning('TTS bad request: %s', error)
        return jsonify({'error': error}), 400

    total_chars = sum(len(s['text']) for s in segments)
    voices = ', '.join(dict.fromkeys(s['voice'] for s in segments))
    preview = text_preview(segments[0]['text'])
    logger.info('TTS request: voices=%s chars=%d speed=%s text="%s"', voices, total_chars, speed, preview)

    start = time.time()
    try:
        all_audio = []
        for _gs, audio, _voice in generate_all_segments(segments, speed):
            all_audio.append(audio)

        if not all_audio:
            logger.error('TTS failed: no audio generated for text="%s"', preview)
            return jsonify({'error': 'No audio generated'}), 500

        full_audio = np.concatenate(all_audio)
        buf = io.BytesIO()
        sf.write(buf, full_audio, SAMPLE_RATE, format='WAV', subtype='PCM_16')
        buf.seek(0)
        audio_bytes = buf.read()

        duration = time.time() - start
        logger.info('TTS complete: voices=%s duration=%.1fs size=%.1fKB chars=%d', voices, duration, len(audio_bytes) / 1024, total_chars)

        return Response(audio_bytes, mimetype='audio/wav',
                        headers={'Content-Disposition': 'inline; filename="speech.wav"'})
    except Exception as e:
        duration = time.time() - start
        logger.error('TTS error after %.1fs: %s', duration, e, exc_info=True)
        return jsonify({'error': 'TTS generation failed'}), 500


@app.route('/tts/stream', methods=['GET', 'POST'])
@require_token
@limiter.limit('10/minute')
def tts_stream():
    """Stream NDJSON with text + base64 PCM16 audio per chunk.

    Each line: {"text": "...", "voice": "...", "audio": "<base64>", "samples": N}
    Final line: {"done": true}

    Accepts single or multi-voice:
      {"text": "...", "voice": "...", "speed": 1.0}
      {"segments": [{"text": "...", "voice": "..."}, ...], "speed": 1.0}
    """
    segments, speed, error = parse_segments()
    if error:
        logger.warning('TTS stream bad request: %s', error)
        return jsonify({'error': error}), 400

    total_chars = sum(len(s['text']) for s in segments)
    voices = ', '.join(dict.fromkeys(s['voice'] for s in segments))
    preview = text_preview(segments[0]['text'])
    logger.info('TTS stream request: voices=%s chars=%d speed=%s text="%s"', voices, total_chars, speed, preview)

    start = time.time()

    def generate_ndjson():
        chunks = 0
        total_samples = 0
        try:
            for gs, chunk, voice in generate_all_segments(segments, speed):
                pcm = (np.clip(chunk, -1.0, 1.0) * 32767).astype(np.int16)
                audio_b64 = base64.b64encode(pcm.tobytes()).decode('ascii')
                yield json.dumps({'text': gs, 'voice': voice, 'audio': audio_b64, 'samples': len(pcm)}) + '\n'
                chunks += 1
                total_samples += len(pcm)
            yield json.dumps({'done': True}) + '\n'
            duration = time.time() - start
            logger.info('TTS stream complete: voices=%s chunks=%d duration=%.1fs samples=%d chars=%d', voices, chunks, duration, total_samples, total_chars)
        except Exception as e:
            duration = time.time() - start
            logger.error('TTS stream error after %.1fs at chunk %d: %s', duration, chunks, e, exc_info=True)

    return Response(stream_with_context(generate_ndjson()),
                    mimetype='application/x-ndjson',
                    headers={'X-Sample-Rate': str(SAMPLE_RATE)})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050)
