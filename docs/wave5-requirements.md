# Wave 5 任务：审计报告 P0/P1 未完成项

> 写给 Claude 的任务清单。  
> 代码库：`/root/abd-ble-tool`，monorepo (pnpm + turbo)  
> 登录：`13800000001` / `Admin@123`  
> 服务端：`http://120.77.218.138`（Nginx → pm2: abd-api:3001, abd-web:3000）

---

## 背景

4月30日审计报告（`docs/platform-audit-report-20260430.md`）列出了 19 个问题。你已完成的 Wave 1-4 覆盖了：告警系统 ✅、通知 ✅、刷新 token ✅、Swagger ✅、仪表盘 ✅。但 **P0（阻塞级）一个都没做**，**P1 也只做了小部分**。

本文列出 **必须立即解决的 3 个 P0 缺失 + 3 个 P1 缺失**，按优先级排列。

---

## 🔴 P0-1：菜单按角色隔离

**现状**：所有菜单对所有角色可见。company_admin 能看到"生产批次"和"客户公司"——这不合理。

**侧边栏文件**：`apps/web/src/components/Sidebar.tsx`

**要求**：
- `vendor_admin`：看到全部菜单
- `company_admin` / `dept_admin` / `team_leader` / `member`：隐藏 **生产批次** 和 **客户公司管理**
- `production_operator`：只显示 **生产批次**（或只给有限菜单）
- 用 `user?.role` 判断，参考 `apps/web/src/app/(app)/devices/page.tsx` 里已有的角色判断逻辑

---

## 🔴 P0-2：设备手动注册 + 批量导入

**现状**：数据库只有 1 台设备（seed 进去的），用户无法手动添加设备。缺少 `POST /devices` API。

**需要做**：

### 后端：`POST /api/v1/devices`
在 `apps/api/src/routes/devices.ts` 添加：
```
POST /devices — 手动注册单台设备
请求体: { lockId, bleMac, modelId, imei?, firmwareVersion?, ... }
权限: vendor_admin, production_operator
```

### 前端：设备列表页已有 Modal 占位
`apps/web/src/components/ManualRegisterDialog.tsx` 已导入，检查是否已有内容。如果空壳就填上：
- 型号下拉（用 `/api/v1/device-models`）
- lockId、bleMac 必填
- imei、firmwareVersion 选填
- 提交后刷新列表

### 前端：批量导入
`apps/web/src/components/ImportDialog.tsx` 已导入，实现 Excel/CSV 上传 → 解析 → 批量创建。

**参考现有代码**：
- 设备列表页 `apps/web/src/app/(app)/devices/page.tsx` 的 `showRegisterDialog` / `showImportDialog` state
- 型号 API 已在设备列表页 query 里

---

## 🔴 P0-3：用户激活/密码设置流程

**现状**：`POST /api/v1/users` 创建用户后状态为 `"invited"`，但没有设置密码的环节，创建的用户无法登录。

**需要做**：

### 方案（推荐）
创建用户时允许 `vendor_admin` 直接设置初始密码（最简单）：

```
POST /api/v1/users 增加可选字段: password (min 8 chars)
创建时 status=active，password 哈希存到 user.passwordHash
```

或者如果希望保留 invite 流程：
```
1. 创建用户时自动生成 8 位随机初始密码
2. 创建成功后返回初始密码给管理员
3. 首次登录时强制跳转到 /change-password
```

**改哪**：
- 后端：`apps/api/src/routes/users.ts` — POST 端点增加 password 字段
- 前端：`apps/web/src/app/(app)/users/new/page.tsx` — 增加密码输入框

**用户表字段**：`passwordHash`（已有的字段，看 prisma schema）

---

## 🟡 P1-1：设备分配/授权到公司（鸿哥反馈的核心问题）

**现状**：
- `POST /api/v1/devices/ship` ✅ — vendor 发货到公司
- `POST /api/v1/devices/deliver` ✅ — 公司确认入库（API 存在）
- `POST /api/v1/devices/assign` ✅ — 分配到班组（API 存在）
- 前端的 AssignDialog、公司详情页的部门/班组表单 ✅ 也存在

**但数据库 department 和 team 表全是空的（0 行）**，所以前端 AssignDialog 的企业下拉没有选项，无法完成"发货→入库→分配"流程。

**问题分析**：
这其实不是代码没写，而是 **数据没初始化 + 流程连贯性缺失**。

**需要做**：

1. **在 `POST /companies` 创建公司时自动创建默认部门**
   - 公司被创建时，自动插入一个 `name="默认部门"` 的 department
   - 改 `apps/api/src/routes/companies.ts` 的 POST 端点

2. **设备详情页显示授权信息**
   - `apps/web/src/app/(app)/devices/[id]/page.tsx` — 当前只显示基本信息和流转记录
   - 需要加：当前所属公司、当前班组、分配历史

3. **设备列表加"确认入库"操作按钮**
   - 当前设备列表页有 Ship（发货）、Assign（分配）按钮
   - 缺少 Deliver（确认入库）操作 → company_admin 看到 shipped 状态的设备时应有"确认入库"按钮
   - 参考现有的 ShipDialog 和 AssignDialog 模式做个 DeliverDialog

4. **DeviceAssignment 表写入**
   - 当前 `POST /api/v1/devices/assign` 只是改了 device.status 和 device.currentTeamId
   - 但没有往 `device_assignment` 表写记录！
   - 需要在 assign 操作时同步创建 DeviceAssignment 记录

---

## 🟡 P1-2：设备远程控制完善

**现状**：Wave 3 做了 TCP bridge（`apps/gw-server/src/lock-tcp/`），通过 8088 端口与 4G 锁通信。`POST /api/v1/device-commands` 可以下发开锁等指令。

**缺失**：
- 前端设备详情页的 RemoteControl 组件（`apps/web/src/components/RemoteControl.tsx`），检查是否完整可用
- 需要在设备详情页暴露：开锁、关锁、定位等操作按钮
- 未接 4G 的设备（BLE only）仍需通过 APP 操作，需要在前端标明

---

## 🟡 P1-3：CRUD 完善（编辑/删除）

**现状**：
- device, user, company, batch 的 `PUT/PATCH/DELETE` 全部缺失或返回 404
- 前端虽然有 `EditDeviceDialog` 等组件，但提交时后端无对应端点

**需要做**：

### 设备编辑/删除
在 `apps/api/src/routes/devices.ts`：
```
PUT  /devices/:id — 编辑基本信息（lockId, bleMac, modelId, firmwareVersion, doorLabel, batchId 等）
DELETE /devices/:id — 软删除（建议加 deletedAt），仅 vendor_admin 可操作
```

### 用户编辑/删除
在 `apps/api/src/routes/users.ts`：
```
PUT  /users/:id
DELETE /users/:id
```

### 公司编辑/删除
在 `apps/api/src/routes/companies.ts`：
```
PUT  /companies/:id
DELETE /companies/:id
```

前端大多数已经有 Dialog 占位（如 `EditDeviceDialog`），确认它们调用的 API 端点与后端一致。

---

## 执行说明

1. **先拉代码**：`cd /root/abd-ble-tool && git pull`
2. **依赖安装**：`pnpm install --frozen-lockfile`
3. **构建**：`pnpm db:generate && pnpm build`
4. **部署**：`pm2 restart abd-api abd-web abd-worker abd-gw-server`
5. **验证**：`cd /tmp && pnpm vitest --project api` 跑测试

### 重要注意事项

- ⚠️ `apps/web/src/lib/api.ts` 第86-87行的 `baseUrl` 已经有 `|| ''` 修复，**不要把 `?? 'http://localhost:3001'` 改回来**，否则浏览器端登录会报网络错误
- ⚠️ `packages/proto/package.json`、`packages/shared/package.json`、`packages/db/package.json` 的 `main` 字段已经改成指向 `./dist/index.js`（之前指向 `./src/index.ts` 导致生产环境模块加载失败），构建时确认 dist 目录存在
- ⚠️ Nginx 配置在 `/etc/nginx/sites-enabled/abd`，代理 `/api/` → `127.0.0.1:3001`，`/` → `127.0.0.1:3000`
- ⚠️ `.env` 中的 `NEXT_PUBLIC_API_BASE_URL=` 必须为空，`CORS_ORIGIN=http://120.77.218.138`

### 数据库结构参考
- `Device` 表有 `ownerType(vendor|company|team|user)`, `ownerCompanyId`, `currentTeamId`
- `DeviceAssignment` 表有 `deviceId, companyId, scope(company|team|user), teamId, userId, revokedAt`
- `Department` 表有 `id, companyId, parentId, name, code`
- `Team` 表有 `id, companyId, departmentId, name, leaderUserId`

---

写完后推分支，让鸿哥看一下效果。
