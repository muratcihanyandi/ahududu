# Ahududu - High Performance Raspberry Pi 5 Dockerfile
FROM python:3.11-slim

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=33470 \
    UPLOAD_DIR=/data/uploads \
    STATIC_DIR=/app/backend/static

# Install curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application and static assets
COPY backend/app ./backend/app
COPY backend/static ./backend/static

# Create uploads directory
RUN mkdir -p /data/uploads

EXPOSE 33470

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:33470/api/system/version || exit 1

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "33470"]
