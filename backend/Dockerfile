FROM node:22-bookworm-slim

# Install system dependencies: Tesseract OCR, Python3, python-docx, Cairo, Pango, and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    python3 \
    python3-pip \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    curl \
    && python3 -m pip install --no-cache-dir --break-system-packages python-docx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY backend/package*.json ./backend/
COPY ai-service/package*.json ./ai-service/

# Install Node dependencies
RUN cd /app/backend && npm install --omit=dev
RUN cd /app/ai-service && npm install --omit=dev

# Copy source code
COPY backend/ ./backend/
COPY ai-service/ ./ai-service/

# Ensure runtime directories exist
RUN mkdir -p /app/backend/src/uploads /app/backend/generated

WORKDIR /app/backend

EXPOSE 9000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:9000/api/v1/health || exit 1

CMD ["node", "server.js"]
