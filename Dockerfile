# Imagem Python do bot árbitro, do simulador de jogadores e do servidor do cliente web.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ultima ultima
COPY web web
COPY tests tests
COPY scripts scripts

CMD ["python", "-m", "ultima.bot"]
