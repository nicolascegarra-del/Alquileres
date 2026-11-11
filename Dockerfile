FROM python:3.13-alpine

# tzdata: para que "hoy" y los días de cobro sigan la hora de España.
RUN apk add --no-cache tzdata \
 && adduser -D -u 10001 klyp \
 && mkdir -p /data \
 && chown klyp:klyp /data

ENV TZ=Europe/Madrid \
    PORT=3000 \
    DATA_DIR=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY server.py ./
COPY public ./public

USER klyp
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["python", "server.py"]
