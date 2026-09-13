import os
import time
import base64
import logging
import functools
import tempfile

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from faster_whisper import WhisperModel

app = Flask(__name__)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('stt')
CORS(app)

API_TOKEN = os.environ.get('STT_API_TOKEN', '')
MODEL_SIZE = os.environ.get('STT_MODEL_SIZE', 'small')

limiter = Limiter(get_remote_address, app=app, default_limits=[])

# Load model once at startup (CPU, int8 quantized for speed/memory)
logger.info('Loading Whisper model: %s', MODEL_SIZE)
model = WhisperModel(MODEL_SIZE, device='cpu', compute_type='int8')


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


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'engine': 'faster-whisper', 'model': MODEL_SIZE})


@app.route('/transcribe', methods=['POST'])
@require_token
@limiter.limit('20/minute')
def transcribe():
    """Transcribe an audio clip to text.

    Accepts either:
      - multipart/form-data with a file field named "audio"
      - JSON: {"audio": "<base64>", "language": "he"}

    "language" is an optional ISO 639-1 code — omit it to auto-detect
    (this household's voice messages are a mix of Hebrew and English).
    """
    if request.content_type and 'multipart/form-data' in request.content_type:
        file = request.files.get('audio')
        if not file:
            return jsonify({'error': 'audio file is required'}), 400
        audio_bytes = file.read()
        language = request.form.get('language') or None
    else:
        data = request.get_json(silent=True) or {}
        b64 = data.get('audio')
        if not b64:
            return jsonify({'error': 'audio (base64) is required'}), 400
        audio_bytes = base64.b64decode(b64)
        language = data.get('language') or None

    start = time.time()
    try:
        with tempfile.NamedTemporaryFile(suffix='.ogg') as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            segments, info = model.transcribe(tmp.name, language=language, vad_filter=True)
            text = ''.join(seg.text for seg in segments).strip()

        duration = time.time() - start
        logger.info('Transcribe complete: lang=%s duration=%.1fs chars=%d', info.language, duration, len(text))
        return jsonify({'text': text, 'language': info.language})
    except Exception as e:
        duration = time.time() - start
        logger.error('Transcribe error after %.1fs: %s', duration, e, exc_info=True)
        return jsonify({'error': 'Transcription failed'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8060)
