# 部署

## 本地快速启动

```bash
cd data-platform
cp config/settings.example.yaml config/settings.yaml
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml --profile seed run --rm seed
open http://localhost:8000/
```

## 不用 Docker

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config/settings.example.yaml config/settings.yaml
python -m src.seed                                        # 灌演示数据
uvicorn --factory src.api.app:create_app --host 0.0.0.0 --port 8000 --reload
```

## 接真实 API 后

1. 在 `config/settings.yaml` 里把 `importgenius.enabled` / `tendata.enabled` 改为 `true`，
   填 `api_key`。
2. 将 `src/crawlers/importgenius.py` 与 `src/crawlers/tendata.py` 中的 TODO
   替换为真实 endpoint 路径与 payload 字段。
3. 运行端到端管道：
   ```bash
   python -m src.pipelines.ingest --country NG --year 2024 --month 6
   ```
