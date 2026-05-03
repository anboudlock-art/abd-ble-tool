# 蓝牙锁 APP 通信协议 v1.4 — GET_IMEI 指令增补

> 在 v1.3 基础上新增一条命令 **0x60 GET_IMEI**。
> 用于：4G 锁注册时由 APP 通过 BLE 一次性读取 4G 模组 IMEI，跟 lockId、BLE MAC 一起上传后台绑定。
> v1.3 其它命令（0x10/0x20/0x21/0x30/0x31/0x40/0x50）**全部不变**。

---

## 1. 背景

v2.6 业务文档要求自动注册流程：扫 QR 拿 lockId → BLE 采 MAC + IMEI + 固件版本 → 上报后台。

v1.3 协议只能读「电量 / 锁杆状态 / 电池盒状态」（GET_STATUS 0x40），**没有读 IMEI 的命令**。本次增补补齐这一项。

由于「BLE+电子铅封」型号没有 4G 模组、本身就没有 IMEI 概念，**仅 4G 锁 / 4G 挂锁 需要实现这条命令**。BLE 电子铅封固件可以选择：
- 不响应（APP 端会显示「未读取到」并允许手输 / 跳过）
- 或者返回错误码（见 §4.4）

---

## 2. 帧格式（沿用 v1.3）

请求 / 响应都先组成原始帧，再 pack 进 16 字节再 AES-128-ECB 加密发送（跟 v1.3 完全一致）。

### 原始请求帧
```
0x55  cmdId  cmd  ...params...  checksum
```

### 原始响应帧
```
0xAA  cmdId  cmd  ...resp...  checksum
```

- **cmdId** 1 字节，APP 端递增 (1-255，跳过 0)；锁应原样回填到响应中以便 APP 配对
- **checksum** = sum of bytes from [1..N-1] **取低 8 位**

### 16 字节加密块封装
```
[0xFB][raw_len][raw payload, 1-14 字节][0xFC × pad to 16 bytes]
```
**重要约束**：原始帧最长 14 字节。设计 v1.4 新命令时必须遵守。

### 密钥派生（沿用 v1.3，未改）
- `key1 = MAC(6B) || 0x11,0x22,0x33,...,0xAA` (10 字节，每字节 0x11×i)
- `key2 = key1` 的最后 6 字节替换为 `[YY-2000, MM, DD, hh, mm, ss]`（当前时间）
- 认证类（AUTH_PASSWD）用 key1，其它命令用 key2

---

## 3. 新命令 0x60 GET_IMEI

### 3.1 请求帧（APP → 锁）

| 偏移 | 字节 | 字段 | 说明 |
|---|---|---|---|
| 0 | 1 | 0x55 | REQ_HEAD |
| 1 | 1 | cmdId | 1-255，跳过 0 |
| 2 | 1 | **0x60** | CMD_GET_IMEI |
| 3 | 1 | sleepMode | 0x01 = 不睡眠继续等命令；0x02 = 应答后立即睡眠 |
| 4 | 1 | checksum | sum(byte[1..3]) & 0xff |

**总长 5 字节**，pack 后 16 字节加密块。

### 3.2 响应帧（锁 → APP）

| 偏移 | 字节 | 字段 | 说明 |
|---|---|---|---|
| 0 | 1 | 0xAA | RESP_HEAD |
| 1 | 1 | cmdId | 回填请求里的 cmdId |
| 2 | 1 | **0x60** | CMD_GET_IMEI |
| 3-10 | 8 | IMEI(BCD) | 见 §3.3 |
| 11 | 1 | checksum | sum(byte[1..10]) & 0xff |

**总长 12 字节**，pack 后 16 字节加密块。

### 3.3 IMEI 的 BCD 编码方式

IMEI 标准 15 位十进制数字，本协议**用 BCD 压缩到 8 字节**。原因：原始帧最长 14 字节，ASCII 编码（15 字节 IMEI）会让响应帧达到 19 字节，超限。

#### 编码规则
- 每字节高 4 位（高 nibble）= 一个数字，低 4 位（低 nibble）= 下一个数字
- 高位在前：第 0 字节 = `digit[0] << 4 | digit[1]`
- 第 7 字节（最后一字节）：高 nibble = `digit[14]`，**低 nibble = 0xF（填充）**

#### 例：IMEI `861234567890123`
| 字节 | 高 nibble | 低 nibble | 字节值 |
|---|---|---|---|
| 0 | 8 | 6 | 0x86 |
| 1 | 1 | 2 | 0x12 |
| 2 | 3 | 4 | 0x34 |
| 3 | 5 | 6 | 0x56 |
| 4 | 7 | 8 | 0x78 |
| 5 | 9 | 0 | 0x90 |
| 6 | 1 | 2 | 0x12 |
| 7 | 3 | **F** | 0x3F |

C 伪代码（固件参考实现）：
```c
void encode_imei_bcd(const char imei[15], uint8_t out[8]) {
    for (int i = 0; i < 7; i++) {
        out[i] = ((imei[2*i] - '0') << 4) | (imei[2*i + 1] - '0');
    }
    out[7] = ((imei[14] - '0') << 4) | 0x0F;
}
```

### 3.4 错误码（IMEI 读取失败时的响应）

如果 4G 模组本身故障 / 上电未完成 / 没有有效 IMEI，**仍然返回 0xAA / cmdId / 0x60 / 8 字节 / checksum**，但 8 字节内容设为：

| 失败原因 | 8 字节固定值 | APP 端识别 |
|---|---|---|
| 模组不在线 / 未上电 | `FF FF FF FF FF FF FF FF` | 全 0xFF → 显示「模组离线」 |
| 通讯超时 | `FE FE FE FE FE FE FE FE` | 全 0xFE → 显示「读取超时」 |
| 模组未就绪 / 无 IMEI | `FD FD FD FD FD FD FD FD` | 全 0xFD → 显示「无 IMEI」 |

**不能直接 disconnect 不响应**，否则 APP 端只能等到超时（5 秒）才知道，体验差。

### 3.5 BLE-only 锁（电子铅封）的处理

BLE 电子铅封没有 4G 模组，理论上**不应支持 GET_IMEI**。固件可选择：
- **方案 A（推荐）**：仍按 §3.4 返回 `FD FD ... FD`（无 IMEI），让 APP 知道这是预期内的「无」
- **方案 B**：完全忽略请求（APP 端 5 秒超时显示「不支持」）

---

## 4. APP 端调用流程

```
1. 已经完成认证（AUTH_PASSWD）后
2. APP 发 buildGetImei(sleepMode=0x01, cmdId=N) → AES-128-ECB → BLE write
3. 锁回 NOTIFY 16 字节 → APP AES 解密 → unpack → parseResponse
4. parseResponse.cmd == 0x60 && cmdId == N → parseImeiResponse(payload)
5. 拿到 15 位 IMEI 字符串
6. POST /api/v1/devices { lockId, bleMac, imei, modelId, ... }
```

---

## 5. 校验向量（固件自测用）

| 输入 | 期望编码 | 期望解码 |
|---|---|---|
| `861234567890123` | `86 12 34 56 78 90 12 3F` | `861234567890123` |
| `352099001761481` | `35 20 99 00 17 61 48 1F` | `352099001761481` |
| `999999999999999` | `99 99 99 99 99 99 99 9F` | `999999999999999` |
| `000000000000001` | `00 00 00 00 00 00 00 1F` | `000000000000001` |

错误向量（必须返回 null / parse 失败）：
- 长度 ≠ 8 字节
- 任一非 0xF 的低位 nibble > 9（例如 `86 1A 34 ...`）

---

## 6. 已确认不变（v1.3 的命令一字不动）

| CMD | 名称 | 描述 |
|---|---|---|
| 0x10 | SET_TIME | 写时间 |
| 0x20 | AUTH_PASSWD | 6 位密码认证（key1） |
| 0x21 | SET_AUTH_PASSWD | 修改密码 |
| 0x30 | OPEN_LOCK | 开锁 |
| 0x31 | CLOSE_LOCK | 关锁 |
| 0x40 | GET_STATUS | 读电量+锁杆+电池盒 |
| 0x50 | FORCE_SLEEP | 强制睡眠 |

帧格式 / 加密 / pack16 / cmdId 规则一律不变。

---

## 7. 后续可能扩展（非本次范围，先记录）

| 候选 CMD | 名称 | 用途 |
|---|---|---|
| 0x61 | GET_FIRMWARE_VERSION | 读固件版本号（v2.6 §1.2 明确要求 BLE 采集固件版本，目前也缺）|
| 0x62 | GET_DEVICE_INFO | 一次性返回 IMEI + 固件 + 硬件 + 电池详情，节省往返 |
| 0x63 | GET_BLE_MAC | 让锁主动上报自己的 MAC（目前从 BLE 广播抓） |

如果厂家方便实现，建议 0x60/0x61/0x62 一次都加上，APP 端联调再切换。**本次只硬性要求 0x60**。

---

## 联系

后端实现：`packages/proto/src/ble/index.ts` 已经有 `BleCmd.GET_IMEI = 0x60`、`buildGetImei()`、`parseImeiResponse()`、`encodeImeiBcd()` 四个工具，连同 6 个单测验证 BCD 编解码正确。

如有疑问联系鸿哥 / Anboud 平台组。
