# v2.8 锁信息自动填充 Spec（基于协议文档）

> 依据: `docs/4gble093_protocol_for_claude.md`
> 当前固件版本: V10.0 源代码

---

## 问题列表（对照协议文档）

### 1. 登录帧 (Sub=0x01) — 匹配逻辑
**协议: Payload [14-19]=BLE MAC, [20-23]=Server IP, [24-25]=Port**
- ❌ 当前只按 `ble_mac` 匹配，锁上报 `00:00:00:00:00:00` 时直接拒
- ✅ 改成两级回退: `lock_id`(frame.lockSN) → `ble_mac` → 拒
- ✅ SN 匹配但 MAC 不同时，自动更新 ble_mac 字段

### 2. 心跳帧 (Sub=0x06) — 固件版本
**协议: Payload=固件版本号字符串 (soft_ver)，如 "V10.0 HW1.2"**
- ✅ handleHeartbeat 已有解析: `frame.payload.toString('ascii').replace(/\0+$/, '')`
- ❌ 但 82730804 的 device.firmware_version 还是 null — 说明心跳没触发更新，或存储的是 raw payload 而不是版本号

### 3. GPS 帧 (Sub=0x0A) — 坐标 + 电池
**协议: [0-3]=时间戳, [4-7]=纬度BCD, [8-11]=经度BCD, [12]=速度, [13]=方向标志, [14+]=锁状态+电池**
- ⚠️ 电池取 [16] 是猜测值，需与协议对照确认 [14] 具体布局
- ❌ 82730804 无 GPS 事件 — 可能室内无定位（正常），需用有信号的锁验证

### 4. 事件帧 (Sub=0x2D) — 锁状态
**协议: [0]=0x2A, [1]=0x55, [2]=Cmd(0x80/0xA0/0x62), [3-6]=LockID, [7]=Gate, [8]=电池, [9]=锁状态(0x50关/0x30开)**
- ⚠️ handleEvent 电池取 [8] 是正确的，验证通过
- ✅ 锁状态解析 [9] 正确
- ❌ 锁未上报过 EVENT — 设备 last_state 始终 unknown

### 5. ACK 帧 (Sub=0x16) — 回执
**协议: [0]=0x2D, [1-2]=report_Serial**
- ⚠️ 当前从 payload[1] 读 UInt16LE，但协议说 [0] 是 0x2D — 是否正确需要验证
- 信息: 锁回执表示收到了服务器指令，但不包含锁状态变化

### 6. 设备详情页显示
- ❌ 后台只显示了几个基础字段（SN, MAC, 状态, 电池0%）
- ✅ 需要增显: IMEI, FW版本, ICCID, GPS坐标, 锁状态(开/关), 最后在线时间

---

## 需要的精确改动

### handlers.ts — handleLogin
```
1. 匹配逻辑改 SN 优先:
   - let device = await prisma.device.findUnique({ where: { lockId: String(frame.lockSN) } });
   - if (!device) device = await prisma.device.findUnique({ where: { bleMac: mac } });
   - 匹配后如果 ble_mac 与上报不同，更新 ble_mac 和 lastSeenAt
```

### handlers.ts — handleHeartbeat
```
1. 确认 firmwareVersion 更新正确存储
2. 同时额外记录 lockEvent(type='heartbeat', source='fourg') 到数据库（当前无）
```

### handlers.ts — handleGps
```
1. 确认 [14] 起的具体布局：电池到底在哪个偏移？
2. 存储 location_lat/lng + lastBattery
```

### handlers.ts — handleLogin 增加
```
1. 登录成功后初始化 last_state = 'closed'（默认关锁状态）
2. lockEvent 记录 online 事件（已有）
```

### 前端设备详情页
```
显示字段: SN, BLE MAC, IMEI, FW版本, ICCID, GPS坐标, 锁状态(开/关), 电池, 最后在线
```

---

## 不改的范围
- 固件不能改（鸿哥要求）
- 下行指令格式已按协议实现（CMD 0x81 开锁），当前可用
- login payload 只有 26 字节有效内容（[0-13]GPS + [14-19]MAC + [20-23]IP + [24-25]Port）

---

## 改动文件
- `apps/gw-server/src/lock-tcp/handlers.ts`
- `apps/gw-server/src/lock-tcp/server.ts`（如有需要）
- `apps/web/src/components/DeviceDetail.tsx`（或对应设备详情页）
