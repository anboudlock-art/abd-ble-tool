# v2.8 GW登录+协议解析修复 Spec（基于官方协议手册260225）

> 依据: 智能GPS物流锁指令协议手册260225.docx + 82730804实测数据
> 分支: claude/smart-lock-web-platform-SUvdF

---

## 一、锁帧结构（对照官方协议）

### 上行帧（锁→服务器）
| 字段 | 字节 | 说明 |
|------|------|------|
| 包头 | 1 | 0xFE |
| 锁ID | 4 | LE编码，如 EB524501 → ID=0x014552EB |
| 地址 | 1 | 主指令地址 |
| 功能码 | 1 | 子功能 |
| 子功能长度 | 1 | |
| 数据长度 | 1 | = 地址到CRC结束的字节数 |
| 数据内容 | N | payload |
| CRC8 | 1 | 范围: 锁ID→数据内容 |
| 包尾 | 1 | 0xFF |

### gw-server 内部: `frame.payload` = 数据内容部分（已解帧）

---

## 二、需要修改的内容

### 1. handleLogin — 匹配逻辑改 SN 优先 + 解析IMSI

```
协议: 数据内容 = 26B GPS + 15B IMSI(后15位，ASCII)
存储: raw_payload 存的就是这完整数据内容

改动:
1. 从 frame.lockSN 匹配 device.lock_id（SN优先）
2. SN找不到再 fallback 到 frame.payload[14:19] 的 BLE MAC
3. 匹配后:
   a. 如果 ble_mac 与上报不同，自动更新 ble_mac
   b. 提取 payload[26:41] 的 IMSI 后15位 → 写 device.iccid（确实是 ICCID/IMSI数据）
   c. 更新 last_seen_at
   d. 创建 lockEvent(type='online', source='fourg', rawPayload)
```

### 2. handleHeartbeat — 响应授时 + 解析32字节心跳

```
协议: 心跳帧上行后，服务器需下发 0x21 0x10 授时响应
否则锁会反复重连（已在实测中验证：锁每30秒重连）

改动:
1. 收到心跳帧后，立即下发行 0x21 0x10 授时
   格式: YY/MM/DD,hh:mm:ss+08 (20字节ASCII)
   示例: FE 21 10 00 19 + 时间串 + CRC + FF

2. 心跳载荷解析（如果心跳帧有数据内容，按协议3.2节解析）
```

### 3. handleGps — 按协议解析 GPS 帧 

```
协议3.2.3 GPS数据上传: 地址0x03, 功能码0x0A
数据内容 = 26B GPS + 10B 基站(MCC+MNC+LAC+CELL_ID+CSQ)

GPS 26字节解析:
  [0-3]   时间戳 (4B, 大端)
  [4-7]   纬度 (4B, 大端)
  [8-11]  经度 (4B, 大端)
  [12]    速度 (1B, 0x00-0x7F, 单位节)
  [13]    方向+GPS标志
  [14]    GPS天线+定位状态+司机编号
  [15-17] 累积里程 (3B)
  [18-20] 终端状态 (3B)
  [21-24] 报警位 (4B): A0-A3
  [25]    异或取反校验

报警位:
  A0: SIM卡拆/BIT2锁杆开/BIT3电压低/BIT4拆壳/BIT5锁杆剪断
  A2: 锁电量(百分比)
  A3: 锁状态(LockStatus: 0x10开/0x30假锁/0x40施封/0x50上锁/0x60解封/0x7x报警)
```

### 4. 响应 GW 登录（下行登录确认）

```
协议: 锁发 login 后需要服务器确认（或下发0x21 0x10授时）
```

### 5. 解析 login 帧的 IMSI/ICCID 后15位

```
协议: 15B IMSI后15位(ASCII)
82730804 上报: "8911026C0032832"
→ 存入 device.iccid 字段（同时放宽 schema 允许含字母）
```

### 6. 新增扩展类指令：查询 IMEI（0x33）

```
协议1.2表格: 新增扩展类 - ICCID/IMEI查询 → 地址0x33
需要 CMD 0x33 去主动查询 IMEI 和 ICCID 完整值
具体子功能码需对照老平台逻辑
```

---

## 三、设备信息自动填充映射

| 字段 | 来源帧 | 协议偏移 |
|------|--------|----------|
| imei | 0x33查询 | 待查 |
| iccid/imsi | login 0x07/0x01 | payload[26:41] ← 15B IMSI后15位ASCII |
| firmware_version | heartbeat 0x03/0x06 | 待确认心跳载荷格式 |
| last_battery | GPS 0x03/0x0A | GPS[18-20]终端状态, 或按报警位A2解析 |
| location_lat | GPS 0x03/0x0A | GPS[4-7] 纬度BCD |
| location_lng | GPS 0x03/0x0A | GPS[8-11] 经度BCD |
| last_state | GPS/电子锁响应 | GPS[21-24]A3=锁状态 |
| fourg_mac | 手动录入 | 非帧数据 |

---

## 四、不改的范围
- 固件：不动
- frame.codec 解帧逻辑：不动
- 下行指令格式：不动（CMD 0x81 0x2D 已按协议实现）

---

## 五、文件范围
- `apps/gw-server/src/lock-tcp/handlers.ts` — 核心修改
- `apps/gw-server/src/lock-tcp/server.ts` — 下行授时
- `packages/proto/src/lock-tcp/index.ts` — GPS解析helper
- `packages/shared/src/schemas.ts` — ICCID schema可能放宽

---

## 六、关键协议引用
- 帧结构: 协议手册 二、核心帧结构
- Login: 协议手册 3.1.1 (0x07/0x01)
- 心跳+授时: 协议手册 3.2.2 (0x21/0x10)
- GPS: 协议手册 3.2.3 (0x03/0x0A)
- 锁状态定义: 协议手册 5.1 (LockStatus)
- 报警位: 协议手册 5.4 (A0-A3)
- CRC8: 协议手册 四 (多项式 x⁸+x⁵+x⁴+1)
