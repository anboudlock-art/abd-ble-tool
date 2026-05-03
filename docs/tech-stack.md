# 技术选型（Tech Stack）

**版本**: v0.1
**状态**: 待审核

---

## 1. 总览

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 / 客户端                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Web 管理  │  │ Android  │  │   iOS    │  │ 第三方系统    │   │
│  │   平台    │  │   APP    │  │   APP    │  │ (对接层)      │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└───────┬───────────────┬──────────┬───────────────┬─────────────┘
        │ HTTPS         │ HTTPS    │ HTTPS         │ HTTPS / MQTT
        ▼               ▼          ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   阿里云 API Gateway / SLB                       │
└───────┬────────────────────────────────────────┬────────────────┘
        │                                         │
        ▼                                         ▼
┌──────────────────┐                     ┌────────────────────────┐
│  Next.js (前端)   │                     │   Fastify API (后端)    │
│  - App Router    │                     │   - REST + WebSocket   │
│  - Server Comp.  │                     │   - OpenAPI 3.1        │
└──────────────────┘                     └───────┬────────────────┘
                                                  │
            ┌─────────────────────────────────────┼──────────────────┐
            │                                     │                   │
            ▼                                     ▼                   ▼
┌────────────────────┐                  ┌──────────────────┐  ┌──────────────┐
│ PostgreSQL (RDS)    │                  │   Redis          │  │ OSS 对象存储  │
│ - 业务主数据         │                  │ - 会话 / 队列     │  │ - 照片       │
│ - lock_event 分区表 │                  │ - WS Pub/Sub     │  │ - APK/IPA    │
└────────────────────┘                  └──────────────────┘  └──────────────┘
                                                  ▲
                                                  │
                                    ┌─────────────┴─────────────┐
                                    │  Gateway TCP Server       │
                                    │  (独立进程, 端口 8901)     │
                                    │  - 解析协议帧              │
                                    │  - 网关会话管理            │
                                    │  - LoRa 上行/下行路由       │
                                    └─────────────▲─────────────┘
                                                  │
                                                  │ TCP
                                                  │
                                          ┌───────┴────────┐
                                          │  CDEBYTE 网关   │
                                          │  (多台)         │
                                          └───────┬────────┘
                                                  │ LoRa
                                                  ▼
                                          ┌────────────────┐
                                          │   智能锁       │
                                          └────────────────┘
```

---

## 2. 后端

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Node.js 20 LTS | 团队 TS 友好；网络 IO 性能够；生态丰富 |
| 语言 | TypeScript 5.x | 强类型，和前端共享类型声明 |
| HTTP 框架 | Fastify 5 | 比 Express 快 2-3 倍；原生 Schema 校验；内置 OpenAPI |
| ORM | Prisma 5 | Schema-first；迁移工具成熟；类型推导强 |
| 数据库 | PostgreSQL 16（阿里云 RDS） | JSON / 分区 / 全文搜索都原生支持 |
| 缓存 | Redis 7（阿里云 Redis） | 会话存储、速率限制、WebSocket pub/sub |
| 任务队列 | BullMQ（基于 Redis） | Webhook 重试、告警异步处理、定时任务 |
| 实时推送 | Fastify-WebSocket + Redis Pub/Sub | 管理后台实时看设备在线状态 |
| 对象存储 | 阿里云 OSS | 现场照片、APK/IPA、OTA 固件包 |
| 短信 | 阿里云短信服务 | 登录验证码 / 告警 |
| 日志 | pino + 阿里云 SLS | 结构化 JSON 日志 |
| 监控 | 阿里云 ARMS | APM + 告警 |
| API 文档 | OpenAPI 3.1（@fastify/swagger）| 对接层客户需要，配套 Redocly |
| 鉴权 | JWT（短 token）+ Refresh Token | Web 后台用 HttpOnly Cookie |
| 对接鉴权 | HMAC-SHA256（类似阿里云 API 签名）| 开放 API 给第三方 |

### 2.1 网关 TCP 接入（独立进程）

- 独立于 HTTP API，进程名 `gw-server`，端口 8901
- Node.js `net` 模块
- 连接状态存 Redis（`gw:session:{gw_id}` hash），跨进程共享
- 事件通过 Redis Stream 发给主 API 入库
- 下行指令也通过 Redis Pub/Sub 触发，gw-server 订阅后写 socket

### 2.2 模块划分（monorepo）

```
abd-ble-tool/
├── apps/
│   ├── api/          # Fastify HTTP + WebSocket 后端
│   ├── gw-server/    # TCP 网关接入服务
│   ├── web/          # Next.js 前端（管理平台）
│   └── worker/       # BullMQ worker（Webhook / 告警 / 分析）
├── packages/
│   ├── db/           # Prisma schema + migrations
│   ├── proto/        # 协议编解码器（BLE / LoRa / Gateway）
│   ├── shared/       # 类型、枚举、常量、zod 校验
│   └── ui/           # 前端共享组件库
├── mobile/
│   ├── android-user/ # 用户端 APP（Kotlin / Jetpack Compose）
│   ├── android-prod/ # 生产端 APP（复用 BLE SDK）
│   └── ios/          # iOS APP（SwiftUI）
└── docs/
```

---

## 3. 前端（Web 管理平台）

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js 15（App Router） | 服务端渲染 + 流式 SSR；路由/表单工程化成熟 |
| UI | shadcn/ui + Tailwind CSS 4 | 可拷贝组件，风格统一，后期改皮肤容易 |
| 图表 | Recharts（简单）/ ECharts（复杂）| 运营图表用 ECharts，一般用 Recharts |
| 表格 | TanStack Table v8 | 大数据量表格（设备列表几万行）| 
| 表单 | React Hook Form + Zod | 与后端 Zod schema 共享校验 |
| 状态 | Zustand + TanStack Query | 服务端状态 + 局部 UI 状态分开 |
| 地图 | 高德地图 JS API | 国内唯一选择 |
| i18n | next-intl | 中英双语，面向未来海外客户 |
| 构建 | Turbo（monorepo）+ Next.js 内置 | |

---

## 4. 移动端

| 平台 | 选型 | 理由 |
|---|---|---|
| Android | Kotlin + Jetpack Compose | 新代码全 Compose；保留对 `BleLockSdk.kt` 的直接调用 |
| iOS | Swift 5.10 + SwiftUI | BLE 用 CoreBluetooth；单独实现同一协议栈 |
| 跨平台 | **不用** | BLE + AES + MAC 派生密钥这类底层操作 Flutter/RN 体验差，iOS/Android 各写一套 UI，共享后端 API |

### 4.1 一 APP 多角色

登录时根据后端返回的 `role` 切换首页：

- `production_operator` → 生产模式（QR 扫码 + BLE 批量采集）
- `company_admin` / `dept_admin` / `team_leader` → 管理模式（分配、授权、部署）
- `member` → 用户模式（开锁、查状态、收告警）

---

## 5. 基础设施（阿里云）

| 资源 | 规格（初始） | 备注 |
|---|---|---|
| ECS（API + Worker + gw-server） | 4C8G × 2 台 | 容器化部署，后期接入 ACK |
| ECS（前端 Next.js）| 2C4G × 2 台 | 或 Vercel？要备案 → 阿里云 |
| RDS PostgreSQL | 通用型 4C8G，200GB SSD | 主从 |
| Redis | 社区版 2GB | 后期集群 |
| SLB | 标准型 | TCP 负载均衡 gw-server 两台 |
| OSS | 标准存储 100GB | 含 CDN |
| 短信 | 按量 | 预算 1000 元/月 |
| ICP 备案 | 工信部 | **20 个工作日，请提前准备**|
| 域名 | `abdlock.com` 或自有域名 | 需备案 |

---

## 6. CI/CD

| 项 | 工具 |
|---|---|
| 代码托管 | GitHub（当前仓库） |
| CI | GitHub Actions（build / test / lint / type-check） |
| CD | 构建 Docker 镜像 → 推阿里云 ACR → ECS 拉取部署 |
| 数据库迁移 | Prisma Migrate 在 CI 里 dry-run，生产由运维手动 `migrate deploy` |
| 密钥管理 | 阿里云 KMS + GitHub Secrets（短期） |
| 观测 | 阿里云 ARMS + SLS + 自建 Grafana（Prometheus） |

---

## 7. 安全基线

- 所有外网入口走 HTTPS（阿里云 SSL 证书）
- 前端禁用 `localStorage` 存 token，只用 HttpOnly Cookie + CSRF Token
- 后端 Helmet / Rate Limit 都开
- BLE 密钥绝不入库（密钥由 MAC 派生，数据库只存 MAC）
- 网关 TCP 明文 → 未来加 TLS（CDEBYTE 部分型号支持）
- 审计日志 `audit_log` 表不允许软删
- 密码哈希 bcrypt（cost=12）
- 对接 API 用 HMAC-SHA256 签名，AppSecret 只在创建时展示一次
- Webhook 投递带 HMAC-SHA256 签名头（`X-Abd-Signature`）

---

## 8. 分阶段交付

### Phase 0（2 周）— 奠基
- 仓库骨架 + CI 跑通
- Prisma schema 初始化 + PostgreSQL 本地 Docker
- 登录 / 组织结构 / 用户管理（仅 Web 后台）
- 阿里云账户 + ICP 备案启动

### Phase 1（3 周）— 设备主数据
- 设备型号 / 生产批次 / 设备 CRUD
- 生产 APP（Android）：扫 QR + BLE 采集入库
- 设备生命周期状态机
- 设备流转记录

### Phase 2（3 周）— 授权与部署
- 部门 / 班组 / 人员管理
- 设备分配 + 授权（时间窗）
- 现场部署（APP 端）
- Web 后台设备地图视图

### Phase 3（3 周）— 远程控制 + 实时
- gw-server TCP 接入服务
- Gateway 注册 / 心跳 / LoRa 上下行
- 远程开/关锁 + 指令超时管理
- 锁事件实时推送（WebSocket）

### Phase 4（3 周）— 用户端 APP
- Android 用户 APP（开锁、查状态、告警）
- iOS APP（功能对等）
- 推送（华为 / 小米 / APNs）

### Phase 5（2 周）— 对接层
- 开放 API（AppKey + HMAC）
- Webhook 订阅与投递
- OpenAPI 文档站点

### Phase 6（持续）— 运营增强
- 告警 / 报表 / 日志检索
- 地理围栏 / 轨迹
- OTA 升级

---

## 9. 风险与待定

| 风险 | 影响 | 缓解 |
|---|---|---|
| ICP 备案 20 工作日 | 阻塞上线 | Phase 0 就启动 |
| CDEBYTE DTU 注册包配置细节差异 | 可能需要改协议 | 协议里已留 ASCII fallback |
| iOS 审核（BLE 权限说明）| 上架延迟 | 文案早准备 |
| 阿里云 SLB TCP 四层对粘包透明 | 需要验证 | Phase 3 验证 |
| LoRa 空中碰撞导致丢帧 | 丢事件 | 协议层已有"状态变化即时重报"策略 |
| 电子铅封离线补传冲突 | 事件重复或丢失 | APP 端带唯一 `event_id`，后端去重 |

---

## 修订历史

| 版本 | 日期 | 修改 |
|---|---|---|
| v0.1 | 2026-04-22 | 初稿 |
