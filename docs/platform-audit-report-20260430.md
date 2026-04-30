# Anboud 智能锁管理平台 - 完整走查报告

**测试时间：** 2026-04-30  
**测试地址：** http://120.77.218.138  
**测试账号：** vendor_admin (13800000001 / admin123)  
**技术栈：** Next.js (前端) + NestJS (后端) + JWT 认证 + PostgreSQL

---

## 一、平台现有模块总览

### 前端页面路由（5个功能页面）
| 路由 | 功能 | 状态 |
|------|------|------|
| `/devices` | 设备管理 | ✅ 已实现 |
| `/users` | 人员管理 | ✅ 已实现 |
| `/companies` | 客户公司管理 | ✅ 已实现 |
| `/batches` | 生产批次管理 | ✅ 已实现 |
| `/integrations` | API 对接管理 | ✅ 已实现 |

### 已实现的 API 端点
| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/auth/login` | POST | 登录 |
| `/api/v1/auth/me` | GET | 获取当前用户 |
| `/api/v1/devices` | GET | 设备列表（分页+搜索+状态筛选） |
| `/api/v1/devices/:id` | GET | 设备详情 |
| `/api/v1/devices/assign` | POST | 设备分配到班组 |
| `/api/v1/devices/ship` | POST | 设备发货到公司 |
| `/api/v1/users` | GET/POST | 用户列表/创建 |
| `/api/v1/companies` | GET/POST | 公司列表/创建 |
| `/api/v1/companies/:id` | GET | 公司详情（含部门列表） |
| `/api/v1/device-models` | GET | 设备型号列表 |
| `/api/v1/device-models/:id` | GET | 型号详情 |
| `/api/v1/production/batches` | GET/POST | 批次列表/创建 |
| `/api/v1/production/batches/:id` | GET | 批次详情 |
| `/api/v1/integrations/apps` | GET/POST | API 应用列表/创建 |
| `/api/v1/teams/:id` | GET | 班组详情 |

### 角色体系（6种）
- `vendor_admin` - 厂商管理员（安邦德内部）
- `company_admin` - 公司管理员（客户方）
- `dept_admin` - 部门管理员
- `team_leader` - 班组长
- `member` - 普通成员
- `production_operator` - 生产操作员

### 设备状态流转
`manufactured → in_warehouse → shipped → delivered → assigned → active → returned → retired`

### 现有 5 种设备型号
| 型号 | 类别 | 场景 | BLE | 4G | GPS | LoRa |
|------|------|------|-----|----|-----|------|
| 4G 挂锁 | fourg_padlock | security | ✅ | ✅ | ❌ | ✅ |
| 4G 铅封 | fourg_eseal | logistics | ✅ | ✅ | ❌ | ❌ |
| 电子铅封 | eseal | logistics | ✅ | ❌ | ❌ | ❌ |
| GPS 物流锁 | gps_lock | logistics | ✅ | ✅ | ✅ | ❌ |
| Test GPS Lock | gps_lock | logistics | ✅ | ✅ | ✅ | ❌ |

---

## 二、设备数据模型分析

### 当前设备字段（仅 19 个字段）
```
id, lockId, bleMac, imei, model, firmwareVersion, qcStatus, status,
ownerType, ownerCompanyId, ownerCompanyName, currentTeamId,
lastState, lastBattery, lastSeenAt, doorLabel, deployedAt,
batchId, batchNo, producedAt, createdAt
```

### 工业锁具必需的缺失字段
| 缺失字段 | 说明 | 优先级 |
|----------|------|--------|
| IMEI 号 | 当前 imei 字段存在但全为 null，需要录入和展示 | 🔴 |
| 4G/Cat1 MAC 地址 | 区别于 BLE MAC，4G 模组有独立 MAC | 🔴 |
| LoRa 模组地址 | LoRa 锁需要 DevAddr/DevEUI | 🔴 |
| LoRa 信道参数 | 频段、信道配置 | 🔴 |
| LoRa 密钥 | AppKey/AppSKey/NwkSKey（生产烧录用） | 🔴 |
| 蓝牙名称/广播名 | BLE 广播的设备名称 | 🟡 |
| 硬件版本号 | 区别于固件版本，PCB/硬件修订版 | 🟡 |
| 生产日期 | 与 createdAt（系统录入时间）区分 | 🟡 |
| 出厂日期 | QC 通过后的正式出厂时间 | 🟡 |
| 二维码/条形码号 | 设备唯一标识二维码 | 🟡 |
| 加密芯片序列号 | 安全芯片 ID（如 ATECC608A） | 🟡 |
| SIM 卡号/ICCID | 4G 模组的 SIM 卡标识 | 🟡 |

### 设备型号表也缺字段
| 缺失字段 | 说明 |
|----------|------|
| 产品图片 | 型号照片 |
| 规格参数 | 尺寸、重量、材质、防护等级(IP67等)、电池容量 |
| 工作温度范围 | 户外极端环境的关键参数 |
| 认证信息 | 防爆等级、CE/FCC 等 |
| 默认 LoRa 参数 | 信道、频段、ADR 配置等 |

---

## 三、框架层面问题（两边角色都有）

### 🔴 P0 阻塞级

#### 1. 用户无法激活登录
- 创建用户后状态为 `"invited"`，没有密码设置环节
- 用户创建 API 不支持传入初始密码
- 测试中创建的 company_admin、member 全部无法登录
- **缺乏完整闭环**：创建用户 → 生成初始密码/激活链接 → 首次登录 → 强制改密码

#### 2. 菜单未按角色隔离
所有 5 个菜单项对所有角色可见：
| 菜单 | vendor_admin | company_admin | 应该？ |
|------|:-----------:|:------------:|:------:|
| 设备管理 | ✅ | ✅ | ✅ |
| 生产批次 | ✅ | ❌ 客户不该看到 | 🔴 |
| 客户公司 | ✅ | ❌ 客户不该看到 | 🔴 |
| 人员管理 | ✅ | ✅（限本公司）| ⚠️ |
| 对接 API | ✅ | ✅（限本公司）| ⚠️ |

#### 3. API 无角色权限数据隔离
- vendor_admin 调用 GET /devices 返回全部设备
- company_admin 也应该只能看到自己公司的设备
- 后端没有根据 JWT 中的 role + companyId 自动过滤数据
- 也没有对写操作做角色校验（比如 company_admin 不应该能调 /devices/ship 发货）

#### 4. CRUD 只有 CR，没有 UD
所有主体资源的编辑和删除全部返回 404：
- `PUT/PATCH/DELETE /devices/:id` → 404
- `PUT/PATCH/DELETE /users/:id` → 404
- `PUT/PATCH/DELETE /companies/:id` → 404
- `PUT/PATCH/DELETE /production/batches/:id` → 404

#### 5. 缺少设备手动添加入口
- 当前无 POST /devices 创建端点
- 前端无"添加设备"按钮和表单
- 设备只能靠数据库 seed 脚本预置
- 需要：单个添加表单 + Excel/CSV 批量导入

#### 6. 缺少设备信息导出
- 无法导出设备完整档案
- 生产环节需要导出：锁号、IMEI、BLE MAC、4G MAC、LoRa 模组地址/信道/密钥等
- 需要按批次筛选导出，Excel 格式

---

### 🟡 P1 重要级

#### 7. 客户端缺少"入库确认"操作
设备状态流转链断裂：
```
厂商发货(shipped) → ❓❓❓ → 客户收到(delivered)
```
- 没有"确认收货/入库"端点
- 客户看不到"待入库"的设备列表
- 没有入库验收操作（检查设备完好、配件齐全）
- 正确流程应该是：
  ```
  厂商发货 → 客户"待入库"列表 → 验收确认 → 入库(delivered)
  → 分配到班组(assigned) → 部署激活(active)
  ```

#### 8. 部门/班组 CRUD 全部缺失
- 无法创建/管理部门和班组
- 设备的"分配到班组"功能无法使用（找不到 teamId=1）
- 公司详情返回了 `departments: []` 但无法操作

#### 9. 设备远程操作完全缺失
- 没有开锁/关锁/定位等设备远程控制 API
- 作为智能锁管理平台，这是核心能力空白
- `lastState: "unknown"` 表明设备数据上报链路未建立

#### 10. 告警与事件系统缺失
- 无设备异常告警（低电量、离线、非法开锁）
- 无事件记录（谁在什么时间开锁/关锁）
- 无告警通知推送

#### 11. 操作日志/审计追踪缺失
- 谁在什么时间对哪个设备做了什么 → 完全没有记录
- 无法追溯设备全生命周期操作历史

#### 12. 密码修改和 Token 刷新缺失
- `/auth/change-password` → 404
- `/auth/refresh` → 404
- JWT 有效期 1 小时，过期后只能重新登录

---

### 🟢 P2 改善级

#### 13. 仪表盘与统计缺失
- 无设备状态概览、无统计图表、无报表导出
- vendor_admin 应该看到全局概览（设备总数、在线率、告警数等）
- company_admin 应该看到自己公司设备概况

#### 14. 生产流程不完整
- 批次创建后无法关联设备（生产出来的设备无法绑定到批次）
- 无生产扫码录入
- 无质检流程界面
- 无批次完结操作
- 发货后无物流追踪、无客户签收确认

#### 15. 通知机制缺失
- 设备发货后客户收不到通知
- 设备异常时无人收到告警
- 无站内消息、邮件、短信等通知渠道

#### 16. 搜索与筛选能力弱
- 设备搜索只支持 lockId 关键字
- 不能按型号、状态、公司、批次等多条件组合筛选
- 不能按日期范围筛选

#### 17. 技术债务
- 无 Swagger/OpenAPI 文档
- Token 存储在 localStorage（XSS 风险，应考虑 httpOnly cookie）
- CORS 仅允许 `http://120.77.218.138`
- 分页 pageSize 过大无校验（传 10000 静默返回 pageSize=0）
- `capabilitiesJson` 字段在所有型号中为 null，未启用

---

## 四、客户端 vs 厂商端功能矩阵

| 功能 | vendor_admin（安邦德） | company_admin（客户） | 当前实现 |
|------|:--------:|:----------:|:--------:|
| 登录 | ✅ | ❌ 无法登录 | 🔴 |
| 查看设备 | 全部设备 | 应只看自己的 | ⚠️ 未隔离 |
| 手动添加设备 | 需要 | 不需要 | 🔴 缺失 |
| 批量导入设备 | 需要 | 不需要 | 🔴 缺失 |
| 设备信息导出 | 需要 | 可能需要 | 🔴 缺失 |
| 设备入库确认 | ❌ | 需要 | 🔴 缺失 |
| 设备发货 | ✅ | ❌ | ✅ |
| 分配到班组 | ❌ | 需要 | ⚠️ 缺班组 CRUD |
| 部门/班组管理 | ❌ | 需要 | 🔴 缺失 |
| 远程开锁/关锁 | 需要 | 需要 | 🔴 缺失 |
| 设备告警 | 需要 | 需要 | 🔴 缺失 |
| 操作日志/审计 | 需要 | 需要 | 🔴 缺失 |
| 生产批次管理 | ✅ | ❌ 不该看到 | ⚠️ 未隐藏 |
| 客户公司管理 | ✅ | ❌ 不该看到 | ⚠️ 未隐藏 |
| API 对接 | ✅ | ✅ | ✅ |
| 仪表盘/统计 | 需要 | 需要 | 🔴 缺失 |
| 编辑/删除数据 | ❌ | ❌ | 🔴 全部 404 |
| 密码修改 | ❌ | ❌ | 🔴 缺失 |

---

## 五、优先开发顺序

### P0 — 框架缺陷（不改这些系统没法用）
1. **用户激活/密码设置流程** — 创建用户时生成初始密码或支持设置密码
2. **菜单按角色显示** — company_admin 隐藏"生产批次"和"客户公司"
3. **API 角色权限数据隔离** — 后端根据 role + companyId 自动限制数据范围
4. **设备手动添加** — POST /devices 端点 + 录入表单 + Excel 批量导入
5. **设备 CRUD 完善** — 所有资源的 PUT/PATCH/DELETE 端点
6. **设备字段扩展** — IMEI、LoRa 参数（DevAddr/DevEUI/信道/密钥）、多 MAC、ICCID
7. **设备信息导出** — 按批次导出完整档案，Excel 格式

### P1 — 业务流程闭环
8. **客户入库确认** — shipped → 验收 → delivered 状态流转
9. **部门/班组 CRUD** — 组织架构管理
10. **设备远程操作 API** — 开锁/关锁/定位指令下发
11. **操作日志/审计日志** — 所有操作可追溯
12. **告警系统** — 设备异常、低电量、非法开锁

### P2 — 体验完善
13. **仪表盘/统计概览** — 设备状态图表
14. **密码修改 & Token 刷新**
15. **通知机制** — 发货通知、告警通知
16. **固件 OTA 管理**
17. **地图视图**（GPS 设备）
18. **搜索筛选增强** — 多条件组合筛选
19. **Swagger/OpenAPI 文档**
