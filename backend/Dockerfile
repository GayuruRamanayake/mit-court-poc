FROM python:3.11-slim

# Azure Speech SDK (native library) requires these on Linux - ffmpeg is no
# longer needed since audio now arrives as raw PCM over the WebSocket
# instead of webm files needing conversion.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    libasound2 \
    libpq5 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway sets $PORT at runtime; default to 8000 for local use
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]