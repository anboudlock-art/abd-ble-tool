# Wave 6 补缺清单 — 打通完整业务流程

> 写给 Claude。基于对 `docs/tech-stack.md` 分阶段交付计划 和 `docs/data-model.md` 数据模型 的逐项对账。
> 代码库：`/root/abd-ble-tool`，分支 `claude/smart-lock-web-platform-SUvdF`
> 当前平台完成度约 55%，下面列的是 **必须补齐才能跑通完整业务流程** 的缺口。

---

## 🔴 P0：阻塞业务流程（必须最先做）

### 1. 设备分配到人员（scope=user 分配链路）

**现状**：AssignDialog 只能选班组，`device_assignment.scope` 字段只用了 `team`。`user_membership` 表完全空（用户从未被加入到班组里）。

**需求**：设备分配到班组后，公司管理员应该能**进一步把具体设备授权给班组里的某个人**。完整链路：

```
设备 → 公司 → 部门 → 班组 → 人员
```

**具体要做**：

#### 后端
- `POST /api/v1/devices/assign` 增加 `userId` 可选字段。当传入 userId 时，scope 写 `user` 而非 `team`
- `POST /api/v1/user-memberships` — 将用户加入班组（user_id + team_id + role_in_team）
- `GET /api/v1/teams/:id/members` — 查班组所有成员
- `GET /api/v1/users/:id/devices` — 查用户被分配了哪些设备

#### 前端
- AssignDialog 增加"人员"层级：选完公司→部门→班组后，还有一个"分配人员"下拉（可选，不选则分配给整个班组）
- 公司详情页 `/companies/[id]` 的班组列表里，每个班组旁边加"管理成员"按钮 → 弹出成员管理弹窗
- 设备详情页显示"当前授权人员"

#### 数据库（已有表，只需填充）
- `user_membership` 表：user_id, team_id, role_in_team(leader/member)
- `device_assignment` 表：scope 字段支持 `user`，user_id 在 scope=user 时填写

---

### 2. 远程开锁/关锁 API

**现状**：`POST /api/v1/device-commands` 返回 404！gw-server 的 TCP bridge 已经在跑（8088 端口），前端 RemoteControl 组件存在，但中间少了一个 API 端点。

**要做**：

#### 后端
在 `apps/api/src/routes/` 新建 `device-commands.ts`：
```
POST /api/v1/device-commands
请求体: { deviceId, command: "unlock" | "lock" | "query_status" | "locate" }
权限: vendor_admin, company_admin, team_leader, member（需验证该用户有分配关系）
```
- 创建 DeviceCommand 记录（status=pending）
- 通过 Redis pub/sub 发给 gw-server
- gw-server 收到后通过 TCP 下发给对应网关
- 超时 30s，超时后 status=timeout
- 当收到 lock_event 确认时，status=acked，关联 result_event_id

#### 前端
- `RemoteControl.tsx` 已经存在，确认它调用正确的 API 路径
- 设备详情页暴露 RemoteControl 操作面板

#### 参考
- gw-server TCP 连接已跑在 `localhost:8088`
- Redis pub/sub 模式：`gateway:downlink:{gatewayId}` channel
- DeviceCommand 表（`packages/db/prisma/schema.prisma`）已有完整字段

---

### 3. 设备现场部署（Device Deployment）

**现状**：`device_deployment` 表存在，但没有 API 和前端。设备 assigned→active 这一跳无法在前端完成。

**要做**：

#### 后端
```
POST /api/v1/devices/:id/deploy
请求体: { lat, lng, accuracyM?, doorLabel?, photoUrls? }
```
- 更新 device.status = 'active'
- 创建 device_deployment 记录
- 更新 device.location_lat/lng, deployed_at

#### 前端
- 设备详情页，当设备状态为 assigned 时，显示"现场部署"按钮
- 弹出表单：门号、位置（可地图选点）、拍照上传

---

## 🟡 P1：重要但非阻塞

### 4. 用户编辑 API

**现状**：`PUT /users/:id` → 404，只能删不能改。

**要做**：
- `PUT /api/v1/users/:id`：可编辑 name, phone, role, department, team
- 前端 `/users` 列表页已有编辑按钮（EditUserDialog），确认它接对 API

### 5. 部门/班组独立管理页面

**现状**：API 端点全有（departments.ts 含 departments + teams CRUD），但前端只有公司详情页的内嵌表单。没有一个 `/departments` 或 `/teams` 的独立列表页。

**要做**：
- 在公司详情页 (`/companies/[id]`) 的部门/班组表单确认功能完整即可，独立页面可以稍后
- 最低要求：表单支持创建、编辑、删除部门/班组

### 6. 通知触发规则

**现状**：告警系统有，SMS 框架有，但**没有"哪些告警触发哪些通知"的规则**。

**要做**：
- 告警创建时自动建 notification 记录（后端已有）
- worker 里对 `critical` 级别告警尝试发 SMS（调用 sms.ts 的 stub）
- 前端 alarm 页面已有，确认列表能正常显示

---

## 🟢 P2：体验完善

### 7. 设备 GPS 测试数据

**现状**：唯一的一台设备 lat/lng 全 null，导致地图组件不显示，无法验证。

**要做**：
- 给设备 ID=1 插入模拟 GPS 数据
- 或者在前端设备编辑表单中增加 lat/lng 输入框
- 让鸿哥能看到地图效果

### 8. 搜索筛选增强

**现状**：设备搜索只支持 lockId / MAC / IMEI / doorLabel 关键字。审计报告要求的组合筛选（型号+状态+日期范围）未完整支持。

**要做**：
- 设备列表搜素保留现状即可（已经够用）
- 后期再做日期范围

---

## 执行顺序（推荐）

```
1. 设备分配到人员（API + 前端 Dialog）      ← 鸿哥最关心
2. 远程开锁 API（POST /device-commands）    ← 核心能力空白  
3. 设备部署流程（deploy API）              ← 打通最后一步
4. 用户编辑 API                            ← 快速修复
5. 部门/班组管理确认                        ← 验证即可
```

---

## 参考：请求/响应格式约定

### 设备分配到人员
```
POST /api/v1/devices/assign
{ deviceIds: [1], teamId: 1, userId?: 123 }
→ { assignedCount: 1, scope: "user", userId: "123", teamId: "1" }
```

### 远程开锁
```
POST /api/v1/device-commands
{ deviceId: 1, command: "unlock" }
→ { id: "1", status: "pending", deviceId: 1, commandType: "unlock" }
```

### 现场部署
```
POST /api/v1/devices/1/deploy
{ lat: 23.1273, lng: 114.3528, doorLabel: "2号门", photoUrls?: ["https://..."] }
→ { id: "1", status: "active", deployedAt: "..." }
```

---

## 重要注意事项（沿用 Wave 5）

- ⚠️ `apps/web/src/lib/api.ts` baseUrl 保持 `|| ''`，不要改回 `?? 'http://localhost:3001'`
- ⚠️ `packages/proto|shared|db/package.json` 的 `main` 保持指向 `./dist/index.js`
- ⚠️ 构建命令：`pnpm build`
- ⚠️ 部署命令：`pm2 restart abd-api abd-web abd-worker abd-gw-server`
- ⚠️ Nginx 不归项目管理，不要动 `/etc/nginx/`
- ⚠️ `.env`：`NEXT_PUBLIC_API_BASE_URL=`（空），`CORS_ORIGIN=http://120.77.218.138`
