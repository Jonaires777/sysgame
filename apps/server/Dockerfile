# Imagem do servidor (bot árbitro) e dos scripts de demonstração. Contexto de build: apps/server.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ultima ultima
COPY tests tests
COPY scripts scripts
COPY pytest.ini .

CMD ["python", "-m", "ultima"]
