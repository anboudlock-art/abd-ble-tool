# v2.8 GW 协议适配 Spec（最终版）

> **依据**: 智能GPS物流锁指令协议手册260225 + 82730804实测raw_payload + 老平台业务日志对照
> **分支**: claude/smart-lock-web-platform-SUvdF

---

## 前置知识：帧结构

### 上行帧 = FE + 锁ID(4B LE) + 地址(1B) + 功能码(1B) + 子功能长度(1B) + 数据长度(1B) + 数据内容(N) + CRC8(1B) + FF
### gw-server 的 `frame.payload` = **数据内容部分**（已解帧，只有数据内容）

---

## 任务1: Login 匹配改 SN 优先

**协议**: 登录指令 0x07/0x01，数据内容 = 26B GPS + 15B IMSI后15位(ASCII)

**现状**: `handleLogin` 只按 `frame.payload[14:19]` 的 BLE MAC 查询 device 表

**需求**:
```
1. let device = prisma.device.findUnique({ where: { lockId: String(frame.lockSN) } })
2. if (!device) device = prisma.device.findUnique({ where: { bleMac: macFromPayload(payload) } })
3. 都不匹配 → unknown device
4. 匹配后:
   a. 如果 ble_mac 与上报不同 → 自动更新
   b. 提取 payload[26:41] = IMSI后15位ASCII → 写入 device.iccid/data
   c. 更新 last_seen_at
   d. 写入 lockEvent(type='online', source='fourg')
```

---

## 任务2: 心跳处理 + 授时响应

**协议**: 锁每10秒发心跳，服务器需回复 0x21 0x10 授时，否则锁频繁重连

**82730804 实测**: 锁每30秒重连（idle timeout），因为没收到授时

**需求**:
1. 收到 heartbeat 帧后，立即下发行:
   - 地址 0x21, 功能码 0x10, 格式: `YY/MM/DD,hh:mm:ss+08` (20B ASCII)
   - 示例: `FE 21 10 00 19 32362F30332F32352C3230 3A31363A32302B3038 CRC FF` (需要动态生成时间)
2. 心跳写入 lockEvent(type='heartbeat')

---

## 任务3: GPS 帧完整解析

**协议 3.2.3**: 0x03/0x0A，数据内容 = 26B GPS + 10B 基站
**老平台已验证**: GPS帧包含锁状态和电量

**26B GPS 结构**:
| 偏移 | 长度 | 字段 |
|------|------|------|
| 0-3   | 4B | 时间戳(大端) |
| 4-7   | 4B | 纬度(大端BCD) |
| 8-11  | 4B | 经度(大端BCD) |
| 12    | 1B | 速度(节) |
| 13    | 1B | 方向+GPS标志 |
| 14    | 1B | GPS天线+定位+司机编号 |
| 15-17 | 3B | 累积里程 |
| 18-20 | 3B | 终端状态 |
| 21-24 | 4B | 报警位(A0-A3) |
| 25    | 1B | 异或校验 |

**需求**: 收到 GPS 帧时写入:
- `location_lat` = GPS[4-7] BCD→float
- `location_lng` = GPS[8-11] BCD→float
- `last_battery` = 报警位[2] (A2 = 锁电量百分比)
- `last_state` = 报警位[3] → LockStatus 映射
- `lockEvent(type='gps', lat, lng, battery, ...)`

**LockStatus 映射** (协议 5.1):
```
0x10=opened, 0x30=half_locked, 0x40=sealed, 0x50=locked, 0x60=unsealed, 0x71=cut_alarm
```

---

## 任务4: 电子锁操作响应解析

**协议 3.3.2**: 0x03/0x2D，查询锁状态响应
数据内容 = 业务头+响应码+Cmd+锁ID+电压+锁状态+GPS+基站

**需求**:
1. 解析锁状态(电压+锁状态) → 更新 device
2. 解析 GPS → 更新位置
3. 写入 lockEvent(type='status_response', ...)

---

## 任务5: 设备信息自动填充映射表

| 字段 | 来源 | 协议引用 |
|------|------|----------|
| imei | 0x33 查询 / 手动录入 | 1.2扩展类 |
| iccid | login payload[26:41] (IMSI后15位) | 3.1.1 |
| firmware_version | heartbeat payload (待确认格式) | - |
| last_battery | GPS[21-24] A2 电量% | 5.4 |
| location_lat/lng | GPS[4-7]/[8-11] BCD | 3.2.3 |
| last_state | GPS[21-24] A3 → LockStatus | 5.1/5.4 |
| ble_mac | login payload[14:19] | 3.1.1 |

---

## 任务6: ICCID Schema 放宽

**现状**: `\d{19,20}` 只接受纯数字，但 login 帧中的 IMSI 含字母(C)
**需求**: 放宽为 `[\dA-Fa-f]{15,20}` 或直接允许字母数字混合

---

## 文件范围
- `apps/gw-server/src/lock-tcp/handlers.ts` — handleLogin, handleHeartbeat, handleGps, handleEvent
- `apps/gw-server/src/lock-tcp/server.ts` — 授时下发
- `packages/proto/src/lock-tcp/index.ts` — GPS 解析 helper, 授时帧构建
- `packages/shared/src/schemas.ts` — ICCID schema

---

## 不改
- frame.codec 解帧逻辑（已验证正确）
- 下行指令 0x81 0x2D 格式（已按协议实现）
- 固件（不动）

---

## 验证标准
1. 82730804 锁重连时 login 成功（SN 匹配），不依赖 MAC
2. IMSI后15位 `8911026C0032832` 自动写入设备信息
3. 心跳后不再频繁重连（收到授时响应）
4. GPS 帧正确解析出经纬度、电量、锁状态
