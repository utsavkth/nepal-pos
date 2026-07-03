FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so this layer is cached across code changes.
# (tzdata pip package supplies the zoneinfo data for Asia/Kathmandu timestamps.)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SQLite databases live here; in production this is the Pi's HDD mounted via
# docker-compose (/data/nepal-pos -> /app/data). Created so the app can write
# even before the volume exists.
RUN mkdir -p /app/data

EXPOSE 5000

# One worker with threads keeps all SQLite access inside a single process,
# which sidesteps cross-process file locking — more than enough concurrency
# for a family shop's handful of devices.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--worker-class", "gthread", "--access-logfile", "-", "app:app"]
