# 设备能力矩阵（Device Capability Matrix）

**版本**: v0.1
**用途**: 前端根据设备类型动态显示/隐藏功能；后端对不支持的操作返回 `405 Method Not Allowed`。

---

## 1. 四类产品快照

| # | 型号代码 | 形态 | 场景 | 通讯模组 |
|---|---|---|---|---|
| 1 | `GPS-LOGI-01` | GPS 物流锁 | 物流 | BLE + 4G + GPS |
| 2 | `ESEAL-LOGI-01` | 电子铅封 | 物流 | **仅 BLE** |
| 3 | `4GSEAL-LOGI-01` | 4G 铅封 | 物流 | BLE + 4G |
| 4 | `4GPAD-SEC-01` | 4G 挂锁 | 安防监管 | BLE + 4G + LoRa |

---

## 2. 功能支持表

> ✅ = 支持 ｜ ❌ = 不支持 ｜ 🌗 = 部分支持（脚注说明）

### 2.1 BLE 近场（APP）

| 功能 | GPS 锁 | 电子铅封 | 4G 铅封 | 4G 挂锁 |
|---|:-:|:-:|:-:|:-:|
| BLE 连接配对 | ✅ | ✅ | ✅ | ✅ |
| SET_TIME (0x10) | ✅ | ✅ | ✅ | ✅ |
| AUTH_PASSWD (0x20) | ✅ | ✅ | ✅ | ✅ |
| SET_AUTH_PASSWD (0x21) | ✅ | ✅ | ✅ | ✅ |
| OPEN_LOCK (0x30) | ✅ | ✅ | ✅ | ✅ |
| CLOSE_LOCK (0x31) | ✅ | 🌗¹ | ✅ | ✅ |
| GET_STATUS (0x40) | ✅ | ✅ | ✅ | ✅ |
| FORCE_SLEEP (0x50) | ✅ | ✅ | ✅ | ✅ |

¹ 电子铅封一次性使用：撬/拆/剪即失效，没有"再次关锁"的物理能力。APP 层 CLOSE_LOCK 按钮对电子铅封应隐藏或置灰。

### 2.2 远程控制（平台 / APP 通过 4G 或 LoRa）

| 功能 | GPS 锁 | 电子铅封 | 4G 铅封 | 4G 挂锁 |
|---|:-:|:-:|:-:|:-:|
| 远程开锁 | ✅ | ❌ | ✅ | ✅ |
| 远程关锁 | ✅ | ❌ | ✅ | ✅ |
| 远程查询状态 | ✅ | ❌ | ✅ | ✅ |
| 远程查询位置 | ✅ | ❌ | ❌ | ❌ |
| 远程配置服务器 IP | ✅ | ❌ | ✅ | ✅ |
| 远程固件升级（OTA） | 🌗² | ❌ | 🌗² | 🌗² |

² OTA 二期做，初版不实现。

### 2.3 上报能力

| 功能 | GPS 锁 | 电子铅封 | 4G 铅封 | 4G 挂锁 |
|---|:-:|:-:|:-:|:-:|
| 实时事件（开/关/破拆） | ✅ | 🌗³ | ✅ | ✅ |
| 实时 GPS 定位上报 | ✅ | ❌ | ❌ | ❌ |
| 低电量告警 | ✅ | 🌗³ | ✅ | ✅ |
| 离线状态告警 | ✅ | ❌⁴ | ✅ | ✅ |
| 定时心跳 | ✅ | ❌ | ✅ | ✅ |

³ 电子铅封事件由 APP 本地读取后**延迟上传**（APP 下次联网时补传）。
⁴ 电子铅封没有"在线"概念，不做离线告警。

### 2.4 业务动作

| 动作 | GPS 锁 | 电子铅封 | 4G 铅封 | 4G 挂锁 |
|---|:-:|:-:|:-:|:-:|
| 现场部署（坐标 + 门号） | ✅ | 🌗⁵ | ✅ | ✅ |
| 运单绑定（物流） | ✅ | ✅ | ✅ | — |
| 地理围栏 | ✅ | ❌ | ❌ | ❌ |
| 历史轨迹 | ✅ | ❌ | ❌ | ❌ |
| 授权时间窗 | ✅ | ✅ | ✅ | ✅ |
| 审批工作流（开锁前审批） | ✅ | ✅ | ✅ | ✅ |

⁵ 电子铅封的"部署"约等于"封箱动作"：APP 扫码 + 记录位置，但不常驻某个门，而是记录"在哪封的箱"。

### 2.5 生产环节

| 功能 | GPS 锁 | 电子铅封 | 4G 铅封 | 4G 挂锁 |
|---|:-:|:-:|:-:|:-:|
| 生产 APP QR 扫码入库 | ✅ | ✅ | ✅ | ✅ |
| BLE 采集 MAC | ✅ | ✅ | ✅ | ✅ |
| BLE 采集 IMEI | ✅ | ❌ | ✅ | ✅ |
| 质检标记 | ✅ | ✅ | ✅ | ✅ |
| 写入出厂服务器 IP | ✅ | ❌ | ✅ | ✅ |

---

## 3. 关键分支逻辑（给后端）

### 3.1 是否允许远程控制

```typescript
function canControlRemotely(device: Device): boolean {
  // 电子铅封永远不能远程控制
  if (device.model.category === 'eseal') return false;

  // 必须处于 active 状态
  if (device.status !== 'active') return false;

  // 4G 锁：需要最近 5 分钟有心跳
  if (device.model.has_4g && !device.model.has_lora) {
    return Date.now() - device.last_seen_at.getTime() < 5 * 60 * 1000;
  }

  // LoRa 锁（4G 挂锁）：需要所属网关在线
  if (device.model.has_lora) {
    return device.gateway?.online === true;
  }

  return false;
}
```

### 3.2 事件入库来源

| 设备类型 | 事件来源 | `lock_event.source` |
|---|---|---|
| GPS 锁 | 4G TCP 连接 | `4g` |
| 电子铅封 | APP 通过 HTTPS 补传 | `ble` |
| 4G 铅封 | 4G TCP 连接 | `4g` |
| 4G 挂锁（LoRa）| 网关透传 | `lora` |

### 3.3 UI 组件按能力自动隐藏

前端使用 `<Feature requires="remote_unlock" model={device.model}>` 包装按钮：

```tsx
<Feature requires="remote_unlock" device={device}>
  <Button onClick={unlock}>远程开锁</Button>
</Feature>
```

判断逻辑从 `device_model.capabilities_json` 派生，避免硬编码型号。

---

## 4. 预期 API 错误码

| 场景 | HTTP | 错误码 |
|---|---|---|
| 对电子铅封调远程开锁 | 405 | `DEVICE_FEATURE_UNSUPPORTED` |
| 对离线的 4G 锁下发指令 | 409 | `DEVICE_OFFLINE` |
| 对未部署的锁下发指令 | 409 | `DEVICE_NOT_DEPLOYED` |
| 对未授权的锁下发指令 | 403 | `FORBIDDEN` |

---

## 修订历史

| 版本 | 日期 | 修改 |
|---|---|---|
| v0.1 | 2026-04-22 | 初稿 |
