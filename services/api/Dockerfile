FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 uvms \
    && useradd --uid 10001 --gid uvms --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin uvms \
    && mkdir -p /data/uploads \
    && chown -R uvms:uvms /data

COPY . .

USER uvms
EXPOSE 8000
CMD ["python", "-m", "app.prod_start"]
