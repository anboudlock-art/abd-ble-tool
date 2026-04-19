FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libxml2-dev libxslt-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p data/raw data/processed && \
    cp config/settings.example.yaml config/settings.yaml

EXPOSE 8000

CMD ["uvicorn", "--factory", "src.api.app:create_app", "--host", "0.0.0.0", "--port", "8000"]
