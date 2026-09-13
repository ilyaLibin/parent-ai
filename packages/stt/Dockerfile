FROM python:3.12-slim

WORKDIR /app

COPY packages/stt/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ARG STT_MODEL_SIZE=small
ENV STT_MODEL_SIZE=${STT_MODEL_SIZE}

# Pre-download the model at build time so startup is instant
RUN python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['STT_MODEL_SIZE'], device='cpu', compute_type='int8')"

COPY packages/stt/app.py .

EXPOSE 8060

CMD ["gunicorn", "--bind", "0.0.0.0:8060", "--workers", "1", "--threads", "2", "--timeout", "300", "app:app"]
