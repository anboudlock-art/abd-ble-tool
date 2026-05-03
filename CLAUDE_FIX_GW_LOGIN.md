# gw-server Lock Login Fix Spec

## 问题
gw-server `handleLogin` 仅用 `bleMac` 查设备：
```ts
const device = await prisma.device.findUnique({ where: { bleMac: mac } });
```
锁的 `lockSN`(Frame.lockSN) 在登录帧中已明确携带但被忽略。
当锁上报的 MAC 为 `00:00:00:00:00:00` 或与数据库不一致时，已知 SN 的锁也被拒绝。

## 要求
1. **登录匹配逻辑改为两级回退**: lock_id(SN) → ble_mac → 拒
2. 如果通过 lock_id 匹配成功但 ble_mac 不同，更新设备 ble_mac
3. 如果锁未上报 MAC (全零)，用 lock_id 匹配

## 改动范围
- `apps/gw-server/src/lock-tcp/handlers.ts` — `handleLogin` 函数
