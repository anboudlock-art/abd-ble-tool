# 中国出口非洲数据平台

聚焦中国出口非洲的海关与厂家数据，用于五金工具、建材五金类目的
工厂排名与趋势分析。

## 开发阶段

### 第一阶段：数据采集
- `src/crawlers/customs.py`：海关出口数据爬虫
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
python -m src.crawlers.customs --country NG --year 2024
```
