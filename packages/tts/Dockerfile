FROM python:3.12-slim

# Install espeak-ng (required by kokoro's phonemizer)
RUN apt-get update && \
    apt-get install -y --no-install-recommends espeak-ng && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY packages/tts/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model at build time so startup is instant
RUN python -c "from kokoro import KPipeline; KPipeline(lang_code='a')"

COPY packages/tts/app.py .

EXPOSE 5050

CMD ["python", "app.py"]
