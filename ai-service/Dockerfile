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

WORKDIR /app/ai-service

COPY ai-service/package*.json ./
RUN npm install --omit=dev

COPY ai-service/ ./

EXPOSE 5001

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["node", "server.js"]
