# v2.8 锁信息自动填充 Spec

## 需求
锁上线后，登录帧中的字段应自动解析填充到 device 表；心跳帧中的固件版本/GPS/电池等信息也应实时更新。

## 老平台已显示字段（对照）

| 老平台显示 | 数据来源 | device 表对应字段 | 状态 |
|-----------|---------|-----------------|------|
| SN (82730804) | Frame.lockSN | lock_id | ✅ 已有 |
| IMEI | 登录 payload [26..?] ? | imei | ❌ 需新增解析 |
| FW (V10.0 HW1.2) | Heartbeat payload ASCIZ | firmware_version | ❌ 已有解析但未正确显示 |
| SIM ICCID | 登录帧某偏移? | iccid | ❌ 需新增字段 |
| BLE MAC | 登录 payload [14..19] | ble_mac | ✅ 已解析 |
| 4G MAC | 登录帧某偏移? | 4g_mac | ❌ 需新增字段 |
| 电池 18% | 心跳/GPS 帧 | last_battery | ⚠️ 解析位置可能不对 |
| GPS 坐标 | GPS 帧 | location_lat/lng | ⚠️ 需确认解析正确 |
| 软件版本 | Heartbeat payload | firmware_version | ⚠️ 已有但显示在 firmware_version |

## 要求
1. **登录时解析 IMEI/ICCID/4G MAC**：查阅 4GBLE093 协议文档确认 payload 偏移
2. **心跳帧解析固件版本**：handleHeartbeat 已有解析但需确认是否正确→firmware_version
3. **GPS 帧解析坐标+电池**：handleGps 已有 BCD 解析，需与老平台数据对比验证
4. **锁登录后自动填充 device 表中的在线状态**：last_state 应从 login 后初始化为 'closed'
5. **后台设备详情页显示这些字段**：IMEI、FW、ICCID、电池、GPS

## 改动范围
- `apps/gw-server/src/lock-tcp/handlers.ts` — handleLogin/handleHeartbeat/handleGps 增强
- `packages/proto/src/lock-tcp/index.ts` — 新增 payload 解析函数
- `apps/web/src/` — 设备详情页显示 IMEI/ICCID/FW/电池/GPS 字段
