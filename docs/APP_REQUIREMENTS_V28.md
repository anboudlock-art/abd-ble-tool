# APP 端完整需求文档 v2.8

> 基于原始需求 v2.6-v2.7 + 鸿哥 2026-05-02 新增要求  
> 含对账：原始需求 vs 已实现 vs 待开发  
> 给 Claude 直接开发

---

## 一、两种 APP 用户角色

| 角色 | 账号来由 | 菜单功能 |
|------|---------|---------|
| **客户使用端** | 厂商在PC后台给客户公司开设 | 设备列表、蓝牙开锁、远程开锁、权限申请、临开申请、通知、我的 |
| **生产端** (`production_operator`) | 厂商自己开设 | 设备注册(扫QR+BLE采MAC)、12项生产测试、BLE调试/写参、锁号扫描 |

**区分逻辑：** 登录后根据 `user.role` 判断，`production_operator` → 生产端界面，其余→ 客户端界面

---

## 二、客户使用端（普通用户）

### 底部导航 4 个 Tab

| Tab | 功能 | 说明 |
|-----|------|------|
| 🔒 **设备** | 我的设备列表 + 开锁 | 按授权筛选显示 |
| 📋 **申请** | 权限申请 + 临开申请 | 长期/临时两种 |
| 🔔 **通知** | 审批结果 + 系统通知 | 手机推送栏 + APP内 |
| 👤 **我的** | 个人信息 + 设置 | 改密码、查看公司/班组 |

---

### 2.1 设备 Tab（核心）

#### 2.1.1 设备列表

展示当前用户有授权关系的设备（`GET /users/me/devices`）。

每条设备卡片显示：锁号、状态、门号、电量、班组、MAC

**锁号定位导航（鸿哥重点要求）：**
- 操作人员可能有几十到上百把锁的授权
- 必须提供多种定位方式：
  - **按班组筛选** — 下拉选班组过滤
  - **搜索锁号** — 直接输入锁号搜索
  - **最近使用** — 按最后连接时间排序
  - **我的工作空间** — 用户 scope 的设备（个人直授权）

#### 2.1.2 开锁/关锁 — 核心交互

**锁类型自动判断（鸿哥重点要求）：**

| 锁类型 | 开锁方式 | APP 行为 |
|--------|---------|---------|
| 纯 BLE 锁 | 蓝牙本地开锁 | 只显示「蓝牙开锁」按钮 |
| 4G+BLE 混合锁 | 蓝牙本地 + 远程 | 显示两个按钮；蓝牙已连接时隐藏远程按钮 |

**蓝牙本地开锁流程：**

```
1. 选锁号 → 点击「蓝牙连接」
2. APP 扫描附近 ABD 前缀 BLE 设备
3. 匹配 lockId → 自动连接
4. 连接成功 → 检测锁状态：
   - 关锁态 → 显示「🔓 开锁」按钮 → 点击发送开锁指令
   - 开锁态 → 显示「🔒 关锁」按钮 + 语音提示"请插入锁杆"
5. 关锁时:
   - 操作员将锁杆插入到位
   - 锁返回两个 key 判断锁杆到位信号（与改密码的 BLE 代码可复用）
   - APP 收到到位信号后发关锁指令
```

**远程开锁流程（4G+BLE 混合锁）：**

```
1. 选锁号 → 点击「远程开锁」按钮
2. APP 发 POST /device-commands { command: "unlock" }
3. 后台：
   - 检查用户权限 → 生成开锁指令
   - 通过 TCP bridge(gw-server) 下发到锁
   - 如果锁休眠 → 指令缓存在后台，等锁上线后推送
4. 锁侧：
   - 低功耗模式下需唤醒（现场人员按按键进入4G模式）
   - 进入4G后等待1分钟，无操作休眠
   - 收到指令 → 开锁 → 回复 ack
5. APP 显示结果
```

**关锁流程（远程）：**
- 同上但 command: "lock"
- APP 发关锁指令 → 后台下发 → 锁执行

**特殊场景：远程代开（鸿哥要求）**
- 现场巡检人员没有账号/授权 → 打电话给管理员
- 管理员在 PC 或 APP 上远程下发开锁指令
- 指令缓存到后台 → 等待锁上4G → 自动下发

---

### 2.2 申请 Tab

#### 2.2.1 长期开锁权限申请

**流程：**
```
扫描锁QR码 / 搜索锁号 → 选择设备(可多台) → 填写事由 → 提交
→ 等待公司管理员/组长审批 → 审批通过后自动获得设备授权
```

**已实现 API：**
- `POST /permission-requests` — 提交申请
- `GET /permission-requests` — 我的申请列表（待审批/通过/拒绝三tab）
- `GET /permission-requests/:id` — 申请详情
- `DELETE /permission-requests/:id` — 撤回未审批申请

**待开发：** APP 前端

#### 2.2.2 临时开锁申请

**流程：**
```
扫描锁QR码 / 搜索锁号 → 选单台设备 → 选时长(1h/2h/4h/8h) → 填事由 → 可选紧急🔴 → 提交
→ 审批通过后倒计时生效 → 到期自动失效
```

**已实现 API：**
- `POST /temporary-unlock` — 提交临开
- `GET /temporary-unlock` — 我的临开列表（待审批/使用中/已过期）
- `GET /temporary-unlock/:id` — 临开详情+剩余时间

**待开发：** APP 前端

---

### 2.3 通知 Tab

**三种通知来源：**
| 来源 | 内容 | 推送方式 |
|------|------|---------|
| 审批结果 | "您的开锁申请已通过" / "已拒绝" | 站内 + 手机推送 |
| 设备告警 | 低电量、设备离线 | 站内 + 手机推送 |
| 临开到期 | "临时开锁权限即将到期" | 站内 + 手机推送 |

**已实现 API：**
- `GET /users/me/notifications` — 通知列表
- `PUT /notifications/:id/read` — 标记已读
- `GET /notifications/unread-count` — 未读数量

**待开发：**
- APP 前端
- 手机系统推送（华为/小米/APNS）

---

### 2.4 我的 Tab

| 功能 | 状态 |
|------|:--:|
| 显示姓名、角色、公司、班组 | ⚠️ 简易版已实现 |
| 首次登录强制修改密码 | ❌ 待开发 |
| 修改密码 | ❌ 待开发 |
| 退出登录 | ✅ 已实现 |

**首次改密流程：**
1. 创建账号时 `mustChangePassword: true`
2. 登录后检测 → 强制跳转改密页
3. 改密成功 → `mustChangePassword: false` → 进入主页
4. 对应 API: `POST /auth/change-password`

---

## 三、生产端 APP（`production_operator`）

生产端 APP 与客户端完全隔离，不同菜单。

### 生产端菜单

| 功能 | 说明 | API |
|------|------|-----|
| **设备注册** | 扫QR → BLE采MAC+IMEI → 上传入库 | POST /devices |
| **手动注册** | BLE故障时手输锁号+MAC做兜底 | POST /devices |
| **补采绑定** | 后续补采MAC/IMEI | POST /devices/:id/bind |
| **12项生产测试** | 自动6项+环境2项+人工4项，逐项检测 | POST /production-scans, POST /production-scans/batch |
| **测试记录查询** | 查看某台设备的测试历史 | GET /production-scans?deviceId=X |
| **锁号扫描** | 扫锁身QR码查锁信息 | 本地+API |
| **BLE调试/写参** | 蓝牙写参(IP/端口/密钥等) | BLE APP本地 |

### 不需要的功能
- ❌ 生产批次查看 → 在 PC 后台查
- ❌ 审批权限申请 → 生产端不审批
- ❌ 公司/人员管理 → PC 功能

---

## 四、完整 API 对账

### 已实现 + APP已对接

| API | APP对接状态 |
|-----|:--:|
| POST /auth/login | ✅ |
| POST /auth/refresh | ✅ |
| POST /auth/logout | ✅ |
| GET /auth/me | ✅ |
| GET /users/me | ✅ |
| GET /users/me/devices | ✅ |

### 已实现 + APP未对接

| API | 说明 |
|-----|------|
| GET /users/me/notifications | 通知列表 |
| POST /permission-requests | 提交长期权限申请 |
| GET /permission-requests | 我的申请列表 |
| GET /permission-requests/:id | 申请详情 |
| DELETE /permission-requests/:id | 撤回申请 |
| POST /temporary-unlock | 提交临时开锁 |
| GET /temporary-unlock | 我的临开列表 |
| GET /temporary-unlock/:id | 临开详情 |
| POST /device-commands | 发开锁/关锁/查询指令 |
| GET /device-commands/:id | 查指令结果 |
| GET /devices/:id/status | 设备当前状态+电量 |

### 需补齐的 API

| API | 说明 |
|-----|------|
| POST /auth/change-password | 首次登录改密码 |
| PUT /users/me/password | 修改自己的密码 |

---

## 五、BLE 通信要点（APP 本地）

**蓝牙锁连接参考：**
- 锁 BLE 前缀：`ABD`
- 连接后通过 BLE characteristic 通信
- 开锁/关锁/改参/读状态的 BLE 协议可复用改密码 APP 的现有代码
- 4G 锁也是通过 BLE 写参（IP/端口/密钥）

**锁杆到位检测（鸿哥强调）：**
- 关锁时锁返回两个 key 信号判断锁杆是否到位
- 可复用已有改密码 APP 的这部分代码

---

## 六、开发顺序建议

```
1️⃣ 补充缺失 API（change-password）
2️⃣ 客户端：设备Tab完整（蓝牙开锁 + 远程开锁 + 锁号定位）
3️⃣ 客户端：申请Tab（权限申请 + 临开申请）
4️⃣ 客户端：通知Tab + 我的Tab
5️⃣ 生产端：设备注册 + 12项测试
6️⃣ 生产端：BLE调试/写参
7️⃣ 手机推送（华为/小米/APNS）
```

---

## 七、资料参考

| 文档 | 路径 |
|------|------|
| 完整需求 v2.6 | `docs/requirements-v2.6.md` |
| TCP/BLE 协议 | `docs/4gble093_protocol_for_claude.md` |
| APP API 清单 | `docs/requirements-v2.6.md` 第五部分 |
| 现有 APP 代码 | `anboudlock-art/fixed_clean_app` 分支 `claude/api-schemas-ble-protocol-IgkB5` |

---

*生成: 2026-05-02 16:15 CST | 鸿哥确认后发给 Claude*
