# AssessX API — development/CI image. Migrations run on start; the app listens on 8000.
# Pinned to a digest (Phase 8B, BX-14): the same base image every build. Dependabot proposes updates.
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN adduser --disabled-password --gecos "" assessx

# The hashed lock (Phase 8B, BX-14): the exact, verified dependency closure, nothing resolved at build time.
COPY requirements.lock ./
RUN pip install --require-hashes -r requirements.lock

COPY alembic.ini pyproject.toml ./
COPY alembic ./alembic
COPY app ./app

USER assessx
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status == 200 else 1)"

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --ws-max-size 262144"]
