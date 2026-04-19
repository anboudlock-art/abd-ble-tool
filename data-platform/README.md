# 中国出口非洲数据平台

聚焦中国出口非洲的海关与厂家数据，用于五金工具、建材五金类目的
工厂排名与趋势分析。

## 开发阶段

### 第一阶段：数据采集
- `src/crawlers/` — 海关出口数据，三源并存：
  - `gacc.py`：海关总署公开月报（国别×HS 聚合，免费）
  - `importgenius.py`：ImportGenius 提单级数据（付费 API，含发货方）
  - `tendata.py`：腾道 Tendata 提单级数据（付费 API，中国出口覆盖广）
  - `customs.py`：统一 CLI，按 `settings.yaml` 的 `enabled` 或 `--source` 选择
- `src/collectors/manufacturers.py`：头部工厂信息采集
- `src/classifiers/products.py`：HS 编码与类目映射（五金工具、建材五金）

### 第二阶段：智能体开发
- `src/cleaners/`：数据清洗与标准化
- `src/analytics/`：工厂排名、趋势分析
- `src/api/`：数据查询 API

### 第三阶段：部署测试
- `deploy/`：部署脚本与环境配置
- `tests/`：功能与数据准确性测试
- `web/`：简单查询界面

## 目录结构

```
data-platform/
├── config/          配置文件（settings.example.yaml）
├── src/
│   ├── crawlers/    海关数据爬虫
│   ├── collectors/  厂家数据采集
│   ├── classifiers/ 产品分类
│   ├── cleaners/    数据清洗（阶段二）
│   ├── analytics/   分析引擎（阶段二）
│   ├── api/         查询接口（阶段二）
│   └── storage/     存储层
├── data/            原始与清洗后数据
└── tests/           测试
```

## 快速开始

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config/settings.example.yaml config/settings.yaml
```

编辑 `config/settings.yaml` 填入数据源凭证后，运行：

```bash
# 所有 enabled 的源
python -m src.crawlers.customs --country NG --year 2024

# 指定月份 + 指定源
python -m src.crawlers.customs --country NG --year 2024 --month 6 --source tendata --source importgenius
```

## 数据源对比

| 源 | 免费 | 厂家名 | 粒度 | 覆盖 |
|---|---|---|---|---|
| GACC 月报 | 是 | 否 | 国别×HS 月度聚合 | 全量 |
| ImportGenius | 否 | 是 | 提单级 | 南非、埃及较全 |
| Tendata | 否 | 是 | 提单级 | 中国出口全球全 |

三源合并策略：以 GACC 做大盘校准，ImportGenius / Tendata 补齐厂家与提单维度，
去重键建议为 `(exporter_name, hs_code, ship_date, destination_country)`。
