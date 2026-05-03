# v2.8 设备详情页 + 日志查看 Spec

> 依据: 老平台截图(开关锁日志列表) + 协议手册260225 + 82730804实测
> 分支: claude/smart-lock-web-platform-SUvdF

---

## 一、设备详情页字段增强

**现状**: 只显示 SN, MAC, 状态(unknown), 电池(0%)  
**老平台**: 显示完整字段（IMEI/固件版本/ICCID/4G MAC/电池18%/锁状态等）

**需求 — GET /api/v1/devices/:id 返回字段增加:**
| 字段 | 存储位置 | 来源 |
|------|----------|------|
| imei | device.imei | 手动录入 / 0x33 |
| iccid | device.iccid | login IMSI后15位 / 手动录入 |
| firmware_version | device.firmware_version | 心跳 / 手动录入 |
| fourg_mac | device.fourg_mac | 手动录入 |
| last_battery | device.last_battery | GPS A2 / 电锁响应 |
| location_lat/lng | device.location_lat/lng | GPS |
| last_state | device.last_state | GPS A3 / 电锁响应 |
| last_seen_at | device.last_seen_at | login/心跳 |

**锁状态中文映射**:
```
opened → 开锁
half_locked → 假锁(未施封)
sealed → 施封态
locked → 锁定态
unsealed → 解封态
cut_alarm → 剪断报警
unknown → 未知
```

---

## 二、设备日志查看功能（老平台对标）

**老平台**: 有"开关锁日志列表"，显示业务数据流（上下行、事件类型、时间、GPS信息）

**新平台需求**:
1. 设备详情页底部或独立 tab — **lock_event 列表**
2. 每条显示: 事件类型图标、业务描述、时间、GPS坐标(如有)
3. 事件类型格式化:
   - `online` → 🟢 设备上线
   - `offline` → 🔴 设备离线
   - `heartbeat` → 💓 心跳
   - `gps` → 📍 GPS: 纬度,经度
   - `event` → 🔧 锁事件: 施封/解封/开锁/关锁
   - `ack` → ✅ 指令回执
   - `command` → ⬇️ 下发指令

**API**: 复用 `GET /api/v1/devices/:id/events` 或已有路由

**UI**: 在设备详情页增加"事件日志"tab，分页加载，最新在前

---

## 三、设备 MAC/IMEI/ICCID 手动录入

**现状**: `PUT /api/v1/devices/:id` 支持编辑这些字段，但 schema 限制 ICCID 为纯数字

**需求**:
1. `packages/shared/src/schemas.ts` 放宽 ICCID: `z.string().max(20)` (允许字母数字)
2. 前端设备详情页增加编辑按钮，可编辑: BLE MAC, IMEI, ICCID, FW版本, 4G MAC
3. 编辑保存后刷新页面

---

## 四、文件范围
- `apps/web/src/app/(app)/devices/[id]/page.tsx` — 设备详情页改造
- `apps/web/src/components/DeviceDetail.tsx` — 如有独立组件
- `apps/web/src/components/DeviceEventLog.tsx` — 新增事件日志组件
- `apps/api/src/routes/devices.ts` — 确认 GET /devices/:id 返回字段
- `packages/shared/src/schemas.ts` — ICCID schema

---

## 五、不改
- 数据库表结构（字段已存在）
- 设备其他生命周期流程
