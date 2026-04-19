# 中国出口非洲数据平台

聚焦中国出口非洲的海关与厂家数据，面向五金工具、建材五金类目的
工厂排名与趋势分析。

## 开发阶段（全部已就位，等 API 凭证接入真实源）

### 第一阶段：数据采集
- `src/crawlers/` — 海关出口数据三源：
  - `gacc.py`：海关总署公开月报（国别×HS 聚合，免费）
  - `importgenius.py`：ImportGenius 提单级数据（付费 API，含发货方）
  - `tendata.py`：腾道 Tendata 提单级数据（付费 API，中国出口覆盖广）
  - `customs.py`：统一 CLI，按 `settings.yaml` 的 `enabled` 或 `--source` 选择
- `src/collectors/manufacturers.py`：头部工厂信息采集
- `src/classifiers/products.py`：HS 编码 → 类目映射

### 第二阶段：智能体开发
- `src/cleaners/normalize.py`：厂商名/HS/国别标准化
- `src/cleaners/dedupe.py`：跨源去重（Tendata > ImportGenius > GACC 优先级）
- `src/analytics/ranking.py`：工厂排名（按金额/次数）
- `src/analytics/trends.py`：月度趋势聚合
- `src/api/app.py`：FastAPI 查询服务（`/api/manufacturers/ranking`、
  `/api/shipments/trends`、`/api/shipments/search`、`/api/health`）
- `src/pipelines/ingest.py`：端到端抓取管道（crawl → clean → dedupe → store）
- `src/seed.py`：合成演示数据，无凭证也能跑通全链路

### 第三阶段：部署测试
- `deploy/Dockerfile` + `deploy/docker-compose.yml`：一条命令起服务
- `web/index.html`：简单查询界面（类目/国别/年份筛选 + 排名表 + 趋势图）
- `tests/`：21 个测试覆盖分类器、清洗、去重、分析、API 端点

## 目录结构

```
data-platform/
├── config/          settings.example.yaml
├── src/
│   ├── crawlers/    海关数据三源 + 统一 CLI
│   ├── collectors/  厂家数据采集
│   ├── classifiers/ HS 类目映射
│   ├── cleaners/    标准化 + 去重
│   ├── analytics/   排名 + 趋势
│   ├── api/         FastAPI 查询服务
│   ├── pipelines/   端到端抓取管道
│   ├── storage/     SQLAlchemy 模型 + 会话
│   └── seed.py      演示数据
├── web/             简单查询界面
├── deploy/          Docker + compose
├── data/            DB + 原始数据
└── tests/           pytest 用例
```

## 快速开始（无凭证演示）

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config/settings.example.yaml config/settings.yaml
python -m src.seed                                        # 灌 240 条演示 shipment
uvicorn --factory src.api.app:create_app --port 8000
# 浏览器打开 http://localhost:8000/
```

## 接真实 API 后

1. 在 `config/settings.yaml` 将 `importgenius.enabled` / `tendata.enabled`
   改为 `true`，填 `api_key`（Tendata 还需 `account`）。
2. 打开 `src/crawlers/importgenius.py` 与 `src/crawlers/tendata.py`，
   按 API 文档把 TODO 块替换为真实 endpoint 路径与字段名（返回字段已
   对齐到 `ShipmentRecord`，改完即可跑）。
3. 运行端到端管道：
   ```bash
   python -m src.pipelines.ingest --country NG --year 2024 --month 6
   ```

## 数据源对比

| 源 | 免费 | 厂家名 | 粒度 | 覆盖 |
|---|---|---|---|---|
| GACC 月报 | 是 | 否 | 国别×HS 月度聚合 | 全量 |
| ImportGenius | 否 | 是 | 提单级 | 南非、埃及较全 |
| Tendata | 否 | 是 | 提单级 | 中国出口全球全 |

三源合并策略：以 GACC 做大盘校准，ImportGenius / Tendata 补齐厂家与提单维度，
去重键 `(exporter_name, hs_code, ship_date, destination_country)`。

## 测试

```bash
python -m pytest tests/ -q       # 21 tests, ~1s
```
