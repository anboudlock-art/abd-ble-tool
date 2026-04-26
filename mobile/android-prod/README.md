# Anboud 生产 Android APP

生产线扫码采集应用：扫 QR 锁号 → BLE 读 MAC → 上报到平台。

## 用途

- **登录**：输入手机号 + 密码（角色须为 `production_operator` 或 `vendor_admin`）
- **选择批次**：从平台已创建的生产批次中选一个
- **采集**：用摄像头扫锁体上 8 位 QR 码 → APP 自动 BLE 扫描附近的 `LOCK_*` 设备 → 选信号最强者 → 与该锁握手（`SET_TIME` 验通信）→ 提交到 `POST /api/v1/production/scans`
- **结果**：实时显示成功/重扫/失败；可立即继续下一台

## 开发环境要求

- Android Studio Koala (2024.1.x) 或更新
- JDK 17（项目 `kotlinOptions.jvmTarget = "17"`）
- Android SDK 35（compileSdk）/ minSdk 26（Android 8.0）
- 一台 Android 8+ 真机（**不能用模拟器**——需要 BLE 和摄像头）

## 首次构建

```bash
cd mobile/android-prod
./gradlew assembleDebug
# APK 输出: app/build/outputs/apk/debug/app-debug.apk
```

或在 Android Studio 中打开 `mobile/android-prod` 目录直接 Run。

## 服务器地址配置

默认指向 `http://10.0.2.2:3001`（模拟器对宿主 localhost 的别名）。

真机调试时在登录页 → "修改服务器地址" → 改为局域网 IP（例如 `http://192.168.1.50:3001`）。生产环境改为正式 API 域名。

## 协议依赖

- BLE 协议遵循 `BleLockSdk.kt`（仓库根目录），密钥由 MAC + 时间派生，AES-128 ECB
- API 协议见 `apps/api/src/routes/production-scans.ts` 和 `apps/api/src/routes/auth.ts`

## 当前局限

- 暂无"读固件版本 0x60"指令（待固件团队实现，参见 `docs/device-capability-matrix.md` §3）
- 离线缓存未实现：失败会保留在内存里，APP 重启会丢失
- 一次只能扫一台锁；批量模式后续加

## 权限

- `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`（Android 12+）
- `ACCESS_FINE_LOCATION`（Android ≤11，BLE 扫描需要）
- `CAMERA`（QR 扫描）
- `INTERNET`

首次启动会一次性请求所有权限。
