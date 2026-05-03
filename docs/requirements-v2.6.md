# ABD 智能锁平台 — 完整需求方案 v2.6

> 版本：v2.6 终版 ｜ 鸿哥已审核 + 技术决策已确认 ｜ 给Claude直接开发 ｜ 2026-05-02
> 
> 飞书文档：https://feishu.cn/docx/FNxVdPCqoombk1x1gLLcyJOVnBg
> 
> 1个前置步骤 + 32项功能 + 35个APP API，全链路完整

---

# 第零部分：锁号预生成（注册前置）

锁号提前批量生成、导出，拿去做号码牌和QR码贴锁身。

## 0.1 锁号规则

8位数字：年份后1位 + 月份2位 + 流水号5位。`60500001` = 2026年5月第1台，每月从00001递增。

## 0.2 锁号生成器

PC端，`vendor_admin` 操作。

1. 输入年份+月份 → 系统自动算前缀（如 605）
2. 输入生成数量 + 起始流水号
3. 点"生成锁号" → 批量产生锁号列表
4. 导出三种格式：
   - 📥 Excel锁号清单 → 给印刷厂做号码牌
   - 📥 QR码ZIP包 → 每锁一个PNG，贴锁身
   - 🖨 A4批量打印 → 直接打出来贴标

生成时关联批次号，锁号记入 `production_batch` 表。

---

# 第一部分：设备注册与绑定

## 1.1 核心原理

锁号已印在锁身QR码上。注册 = 扫QR拿锁号 + BLE采MAC+IMEI + 上传绑定。

| 设备类型 | BLE采MAC | BLE采IMEI |
|---|---|---|
| BLE 挂锁 | ✅ | 无 |
| 4G 挂锁 | ✅ | ✅（BLE同时读） |
| 4G 铅封 | ✅ | ✅ |

## 1.2 自动注册（三步）

1. 扫QR拿锁号 → 2. BLE采MAC+IMEI+固件 → 3. 确认上传，入库新生产库

## 1.3 手动注册（保底）

BLE故障时手输锁号+MAC+IMEI，走 POST /devices。

---

# 第二部分：生产测试与报告

## 2.1 12项测试

**自动（6项）：** BLE通信 / 4G联网 / GPS定位 / 电池电压 / 功耗 / 固件版本

**环境（2项）：** 高低温-40~+85℃各2h / 防水IP67 30min

**人工（4项）：** 锁体开关10次 / 外观 / 指示灯 / 配件

## 2.2 测试APP

逐项显示结果，[✅合格] [❌不合格]。

## 2.3 测试数据与报告

### 测试数据全部保留入库

所有12项测试的原始数据永久保留在数据库中，不删除。这是产品质量档案。

### 报告导出

**由管理员决定是否导出、分发给谁**。不是自动发给客户的。导出弹窗可选：仅留存 / 发送给客户公司。导出PDF（含公章位）或Excel。

## 2.4 测试员角色

`production_operator` — 仅APP操作，不能进PC后台。

---

# 第三部分：设备流转与授权管理

> **三库隔离**：用设备 status 区分

| status | 对应库 |
|---|---|
| `manufactured` | 🏭 新生产 |
| `in_warehouse` | 📦 待移交 |
| `repairing` | 🔧 维修中 |

## 3.1 生命全周期

```
锁号预生成→号码牌→贴标→注册→测试→新生产→待移交→发货→客户仓库→授权→部署→使用→退修
```

## 3.2 三库管理

### 🏭 新生产库（manufactured）

底部：[📦 移入待移交] [🔧 退回维修]

### 📦 待移交库（in_warehouse）

按批次分组，可分批发货。底部：[🚚 发货到公司] [📊 导出测试报告] [🔧 退回维修]

### 🔧 维修中库（repairing）

独立维修记录表 `device_repair`（device_id / source_company_id / fault_reason / repair_status / repaired_by / notes）。修好→新生产→重测→待移交→发货回原公司。

## 3.3 公司设备

收货"←新到！"，[确认入库] [分配到班组] [批量授权]

## 3.4 批量授权（N×M）

赋权到人，N台×M人，设有效期。

## 3.5 现场部署

选场景→填位置→GPS→拍照。部署后"运行中"。

## 3.6 授权管理 `/authorizations`

✅有效 ⚠️将过期 ❌过期。撤销/更换。

## 3.7 两套审批

| | 申请开锁权限 | 临开审批 |
|---|---|---|
| 时效 | 长期 | 1h/2h/4h/8h到期 |
| 设备 | 多台 | 单台 |
| 审批 | 可部分同意 | 倒计时自动失效 |

## 3.8 账号角色

| 角色 | 权限 |
|---|---|
| vendor_admin | 三库管理、锁号生成、发货、导出报告 |
| production_operator | 注册、测试（仅APP） |
| company_admin | 入库、分配、授权、审批 |
| dept_admin | 管理班组 |
| team_leader | 班组设备、部署、审批 |
| member | APP开锁、申请 |

---

# 第四部分：技术决策（鸿哥已确认）

1. **三库**：status区分（manufactured / in_warehouse / repairing），不另加字段
2. **手动注册**：POST /devices，和自动注册共用
3. **维修流程**：独立表 device_repair，非 device 表加字段
4. **锁号预生成**：注册前批量生成→导出Excel+QR→做号码牌
5. **测试数据**：永久入库，管理员控制分发
6. **APP后端优先**：先备好所有APP需要的API，APP前端后面开发

---

# 第五部分：APP 端 API 清单（优先开发）

> **鸿哥要求：先把后端API备好，APP前端后面再做。**

## A. 注册与绑定（3个）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/devices | 注册设备（自动带BLE数据、或手动输入） |
| GET | /api/v1/production-batches/:id/lock-numbers | 查询批次锁号列表 |
| POST | /api/v1/devices/:id/bind | 补充绑定MAC/IMEI（后补采时用） |

## B. 生产测试（4个）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/production-scans | 提交单台12项测试结果 |
| POST | /api/v1/production-scans/batch | 批量提交测试结果 |
| GET | /api/v1/production-scans?deviceId=X | 查某台测试记录 |
| GET | /api/v1/production-scans/summary?batch=X | 按批次汇总统计 |

## C. 远程开锁（3个）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/device-commands | 开锁/关锁/查询状态 |
| GET | /api/v1/device-commands/:id | 查指令结果 |
| GET | /api/v1/devices/:id/status | 设备当前状态含电量 |

## D. 长期开锁权限申请（4个）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/permission-requests | 提交申请（可多台设备） |
| GET | /api/v1/permission-requests | 我的申请（待审批/通过/拒绝） |
| GET | /api/v1/permission-requests/:id | 申请详情 |
| DELETE | /api/v1/permission-requests/:id | 撤回未审批的申请 |

## E. 临时开锁申请（3个）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/temporary-unlock | 申请临开（单台+时长+紧急标记） |
| GET | /api/v1/temporary-unlock | 我的临开申请/使用记录 |
| GET | /api/v1/temporary-unlock/:id | 临开详情+剩余时间 |

## F. 现场部署（2个）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/v1/devices/:id/deploy | 部署（GPS+门号+场景+拍照） |
| GET | /api/v1/devices/:id/deployment | 查部署信息 |

## G. 用户信息（4个）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/users/me | 当前用户信息+角色权限 |
| GET | /api/v1/users/me/devices | 我有权限开锁的设备列表 |
| GET | /api/v1/users/me/notifications | 我的通知/审批结果 |
| PUT | /api/v1/users/:id | 编辑用户信息 |

## H. 审批处理 — PC端（5个）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/permission-requests/pending | 待审批的长期开锁申请 |
| POST | /api/v1/permission-requests/:id/approve | 审批（同意部分/全部/拒绝） |
| GET | /api/v1/temporary-unlock/pending | 待审批的临开申请（紧急优先） |
| POST | /api/v1/temporary-unlock/:id/approve | 审批临开申请 |
| POST | /api/v1/temporary-unlock/:id/revoke | 撤销已批准的临开 |

## I. 通知（3个）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/notifications | 通知列表 |
| PUT | /api/v1/notifications/:id/read | 标记已读 |
| GET | /api/v1/notifications/unread-count | 未读数量 |

---

# 第六部分：PC 端功能清单与开发状态

| # | 功能 | 状态 |
|---|---|---|
| 0 | 锁号批量生成+导出Excel/QR | 🆕 新开发 |
| 1 | 自动注册（APP） | ✅ 部分完成 |
| 2 | 手动注册 | ✅ 部分完成 |
| 3 | 锁号自动生成 | ✅ 部分完成 |
| 4 | 锁号↔MAC↔IMEI绑定 | ✅ 部分完成 |
| 5 | 注册后自动入库 | ✅ 部分完成 |
| 6 | 12项生产测试（APP） | ✅ 部分完成 |
| 7 | 环境测试 | ✅ 部分完成 |
| 8 | 人工检查 | ✅ 部分完成 |
| 9 | 测试数据永久入库 | ⚠️ 需完善 |
| 10 | 移入待移交（弹窗） | ⚠️ 需完善 |
| 11 | 测试员角色 production_operator | 🆕 新开发 |
| 12 | 导出测试报告PDF/Excel | ⚠️ 需完善 |
| 13 | 厂商三库总览 | 🆕 新页面 |
| 14 | 待移交库管理 | 🆕 新页面 |
| 15 | 新生产库管理 | 🆕 新页面 |
| 16 | 维修中库+维修表 | 🆕 新页面 |
| 17 | 发货到公司（弹窗选批次+客户） | ⚠️ 需完善 |
| 18 | 公司设备汇总卡片 | ⚠️ 需完善 |
| 19 | 公司设备列表+确认入库 | ⚠️ 需完善 |
| 20 | 批量分配到班组 | ⚠️ 需完善 |
| 21 | 批量授权N×M | 🆕 新开发 |
| 22 | 班组设备子页面 | 🆕 新页面 |
| 23 | 现场部署弹窗 | ⚠️ 需完善 |
| 24 | 授权管理 /authorizations | ⚠️ 需完善 |
| 25 | 设备详情页含授权卡片 | ⚠️ 需完善 |
| 26-28 | APP功能API（A-I组35个） | 🆕 API优先 |
| 29 | PC权限审批 /permission-approvals | 🆕 新页面 |
| 30 | PC临开审批 /temporary-approvals | 🆕 新页面 |
| 31 | 审批弹窗组件 | 🆕 新组件 |

---

# 第七部分：开发优先级

```
1️⃣ 先备35个APP API（A-I组）        ← 鸿哥要求最先
2️⃣ PC端新页面（三库/审批/授权管理）
3️⃣ 完善已有功能（发货/部署/批量操作）
4️⃣ APP前端（后面再做）
```

---

**1个前置 + 32项功能 + 35个APP API。Claude可以直接开工。**
