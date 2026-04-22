# Anboud LoRa-BLE 智能锁平台

> **LoRa-BLE Smart Lock Platform** · monorepo (Web + API + Gateway Server + Workers + Mobile SDK)

---

## 项目结构

```
abd-ble-tool/
├── apps/
│   ├── api/          # Fastify HTTP + WebSocket 后端 (@abd/api)
│   ├── gw-server/    # TCP 网关接入服务 (@abd/gw-server)
│   ├── web/          # Next.js 15 管理平台 (@abd/web)
│   └── worker/       # BullMQ 异步任务 (@abd/worker)
├── packages/
│   ├── db/           # Prisma schema + client (@abd/db)
│   ├── proto/        # LoRa / Gateway / BLE 协议编解码器 (@abd/proto)
│   └── shared/       # 枚举、Zod 校验、API 错误 (@abd/shared)
├── docs/             # 协议文档、数据模型、技术选型
└── docker-compose.yml  # Postgres + Redis + Adminer
```

---

## 快速开始（本地开发）

### 先决条件
- Node.js 20+
- pnpm 10+ (`corepack enable pnpm`)
- Docker + Docker Compose

### 1. 启动 Postgres / Redis

```bash
docker compose up -d
```

- Postgres: `localhost:5432`（用户 `abd` / 密码 `abd_dev_password` / 库 `abd`）
- Redis: `localhost:6379`
- Adminer（DB 管理界面）: http://localhost:8080

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 按需修改 JWT_SECRET 等
```

### 4. 生成 Prisma 客户端 + 初始化数据库

```bash
pnpm db:generate
pnpm db:migrate:dev --name init
pnpm --filter @abd/db exec tsx prisma/seed.ts
```

### 5. 启动所有服务

```bash
pnpm dev
```

各服务端口：
- Web 管理平台: http://localhost:3000
- API 后端: http://localhost:3001
- Gateway TCP 服务: `localhost:8901`

单独启动：

```bash
pnpm --filter @abd/api dev
pnpm --filter @abd/web dev
pnpm --filter @abd/gw-server dev
pnpm --filter @abd/worker dev
```

---

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动所有开发服务（Turbo 并发） |
| `pnpm build` | 构建所有包 |
| `pnpm typecheck` | 全仓库类型检查 |
| `pnpm test` | 运行所有测试 |
| `pnpm lint` | Lint |
| `pnpm db:migrate:dev --name xxx` | 创建新迁移 |
| `pnpm db:studio` | Prisma Studio (浏览器 DB 查看) |
| `pnpm format` | Prettier 格式化 |

---

## 文档

- [`docs/gateway-protocol.md`](docs/gateway-protocol.md) — 网关 ↔ 平台 TCP 协议
- [`LORA_BLE_Lock_Integration_Guide.md`](LORA_BLE_Lock_Integration_Guide.md) — 锁 ↔ 网关 LoRa 协议
- [`docs/data-model.md`](docs/data-model.md) — 数据模型 + ER 图
- [`docs/device-capability-matrix.md`](docs/device-capability-matrix.md) — 设备能力矩阵
- [`docs/tech-stack.md`](docs/tech-stack.md) — 技术选型 + 分阶段交付

---

## 技术栈

- **后端**: Node.js 22 + TypeScript + Fastify 5 + Prisma 5 + PostgreSQL 16 + Redis 7
- **前端**: Next.js 15 + React 19 + Tailwind CSS 4
- **监控 / 部署**: 阿里云 ECS + RDS + OSS + ARMS
- **移动端**（规划中）: Android (Kotlin + Compose), iOS (Swift + SwiftUI)

---

## 部署（阿里云）

详见 [`docs/tech-stack.md`](docs/tech-stack.md) 第 5 节 "基础设施"。

**上线前 Checklist**:
- [ ] 域名 ICP 备案（20 工作日，提前启动）
- [ ] 阿里云 RDS / Redis / OSS / SLB 申请
- [ ] 高德地图开发者 Key
- [ ] 华为推送 / 小米推送 / APNs 证书
- [ ] 阿里云短信模板审核
- [ ] 生产网关 TCP 端口 `8901` 绑定到 SLB 四层

---

## 许可

Proprietary — © Anboud
