# LoRa-BLE 智能锁 固件修改说明及对接指南

## 版本信息
- 固件版本：LORA_BLE_V3_FINAL
- 日期：2026-04-17
- 基于：4GBLE093 源码，替换4G模块为 E220-M900T22S LoRa模块
- MCU：SYD8811 (Cortex-M0)

---

## 一、硬件变更

### 1.1 模组替换
| 项目 | 原4G版本 | 新LoRa版本 |
|------|---------|-----------|
| 通讯模组 | NB-IoT/4G | E220-M900T22S |
| 通讯方式 | TCP/IP (AT指令) | LoRa透传 (UART 9600) |
| 串口波特率 | 115200 | 9600 |
| 传输模式 | TCP连接 | 定点传输(FIXED) |

### 1.2 E220 引脚连接 (SYD8811)
| E220引脚 | SYD8811 GPIO | 功能 |
|---------|-------------|------|
| EN (电源) | GPIO_0 | 通过U3稳压器控制E220电源 |
| M0 | GPIO_4 | 模式控制 (LOW=正常模式) |
| M1 | GPIO_3 | 模式控制 (LOW=正常模式) |
| AUX | GPIO_2 | 忙闲指示 |
| TX | GPIO_5 (RXD1) | UART数据接收 |
| RX | GPIO_6 (TXD1) | UART数据发送 |

### 1.3 E220 模组配置
- 地址：由用户配置（示例：0x0008）
- 信道：由用户配置（示例：0x06）
- 传输模式：定点传输 (FIXED, REG3 bit6=1)
- 波特率：9600
- 空中速率：2.4k
- 发射功率：22dBm

---

## 二、LoRa 通讯协议

### 2.1 锁 → 网关（状态上报）

#### 发送给E220的原始帧（14字节）
```
[目标地址H][目标地址L][目标信道][本机地址H][本机地址L][本机信道][MAC0][MAC1][MAC2][MAC3][MAC4][MAC5][状态][电量]
```

#### E220定点模式去掉前3字节后，网关实际收到（11字节）
```
[本机地址H][本机地址L][本机信道][MAC0][MAC1][MAC2][MAC3][MAC4][MAC5][状态][电量]
```

#### 字段说明
| 字节位置 | 字段 | 长度 | 说明 |
|---------|------|------|------|
| 0-1 | 本机地址 | 2B | 锁的E220模组地址（如 0x00 0x08 = 地址8） |
| 2 | 本机信道 | 1B | 锁的E220模组信道（如 0x06 = 信道6） |
| 3-8 | BLE MAC | 6B | 锁的蓝牙MAC地址（全球唯一标识） |
| 9 | 状态 | 1B | 锁当前状态码 |
| 10 | 电量 | 1B | 电池电量百分比（0x00-0x64 = 0-100%） |

#### 状态码定义
| 状态码 | 含义 | 说明 |
|-------|------|------|
| 0x01 | 开锁 | 锁已打开 |
| 0x10 | 关锁 | 锁已关闭 |
| 0x11 | 剪断/撬锁报警 | 锁体被破坏 |

#### 示例
```
网关收到：00 08 06 E1 6A 9C F1 F8 7E 10 64

解析：
- 锁地址：0x0008 (8号)
- 锁信道：0x06 (6)
- BLE MAC：E1:6A:9C:F1:F8:7E
- 状态：0x10 = 关锁
- 电量：0x64 = 100%

平台通过MAC地址查询数据库 → 锁号：60806001
```

### 2.2 网关 → 锁（指令下发）

#### 网关发送给E220的帧
```
[锁地址H][锁地址L][锁信道][MAC0][MAC1][MAC2][MAC3][MAC4][MAC5][指令]
```

#### 锁实际收到（去掉前3字节路由头）
```
[MAC0][MAC1][MAC2][MAC3][MAC4][MAC5][指令]
```

#### 指令码定义
| 指令码 | 含义 | 前置条件 |
|-------|------|---------|
| 0x01 | 开锁 | 无 |
| 0x10 | 关锁 | 需锁杆插入到位（STATE_KEY + lock_hall检测） |

#### 安全校验
锁收到指令后会**校验MAC地址**是否匹配自身，不匹配则丢弃指令，防止误操作。

#### 示例
```
网关发送（开锁）：00 08 06 E1 6A 9C F1 F8 7E 01
                  ^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^ ^^
                  锁E220地址  锁的BLE MAC地址          开锁指令

网关发送（关锁）：00 08 06 E1 6A 9C F1 F8 7E 10
```

### 2.3 上报时机
| 触发条件 | 说明 |
|---------|------|
| 锁状态变化 | 开锁/关锁/剪断时立即上报 |
| 定时上报 | 每24小时自动唤醒上报一次 |
| LoRa启动后 | 每5秒上报一次，30秒无网关响应自动关闭 |
| 网关指令响应 | 执行开关锁后立即回报状态 |

### 2.4 锁号编码规则
```
锁号格式：60806001
          ^ ^^ ^^ ^^^
          | |  |  |
          | |  |  +-- 序号（001-999，唯一编号）
          | |  +-- 信道（06）
          | +-- 地址（08）
          +-- 年份（6=2026年）

平台通过 BLE MAC 地址绑定锁号，LoRa帧中的地址+信道+MAC三者可唯一定位锁
```

---

## 三、BLE 密码修改协议

### 3.1 BLE 服务 UUID
| 项目 | UUID |
|------|------|
| Service | 6E40000A-B5A3-F393-E0A9-E50E24DCCA9E |
| Notify (设备→手机) | 6E40000B-B5A3-F393-E0A9-E50E24DCCA9E |
| Write (手机→设备) | 6E40000C-B5A3-F393-E0A9-E50E24DCCA9E |

### 3.2 加密方式
- 算法：**AES-128-ECB**
- 无填充（NoPadding），16字节块
- 帧格式：`[0xFB][长度][数据...][0xFC填充]` → AES加密 → 发送

### 3.3 密钥生成

#### Key1（连接时生成）
```
key1[0-5]  = MAC地址（MSB序，如 E1 6A 9C F1 F8 7E）
key1[6]    = 0x11
key1[7]    = 0x22
key1[8]    = 0x33
key1[9]    = 0x44
key1[10]   = 0x55
key1[11]   = 0x66
key1[12]   = 0x77
key1[13]   = 0x88
key1[14]   = 0x99
key1[15]   = 0xAA
```

#### Key2（SET_TIME成功后生成）
```
key2[0-9]  = 与key1相同
key2[10]   = 年（如 0x1A = 26 = 2026年）
key2[11]   = 月（如 0x04 = 4月）
key2[12]   = 日
key2[13]   = 时
key2[14]   = 分
key2[15]   = 秒
```
**注意：key2的时间字节必须与SET_TIME命令发送时的时间一致**

### 3.4 密码修改完整流程

```
APP                                    锁
 |                                      |
 |--- 1. BLE连接 ---------------------->|
 |    （使用key1加密通讯）                |
 |                                      |
 |--- 2. SET_TIME (0x10) ------------->|  用key1加密
 |    55 [cmdId] 10 YY MM DD HH mm SS [BCC]
 |<-- 响应: AA [cmdId] 10 [BCC] -------|  用key1加密
 |    （收到后切换到key2）                |
 |                                      |
 |--- 3. AUTH (0x20) ----------------->|  用key2加密
 |    55 [cmdId] 20 [D1][D2][D3][D4][D5][D6] [BCC]
 |<-- 响应: AA [cmdId] 20 00 [BCC] ----|  密码正确
 |<-- 响应: AA [cmdId] 20 01 [BCC] ----|  密码错误
 |                                      |
 |--- 4. SET_PASSWD (0x21) ----------->|  用key2加密
 |    55 [cmdId] 21 [D1][D2][D3][D4][D5][D6] [BCC]
 |<-- 响应: AA [cmdId] 21 00 [BCC] ----|  修改成功
 |                                      |
```

### 3.5 密码编码方式
**使用数值编码（0-9），不是ASCII编码**

```
密码 "123456" 编码为：
0x01 0x02 0x03 0x04 0x05 0x06   ← 正确（数值）
0x31 0x32 0x33 0x34 0x35 0x36   ← 错误（ASCII）

密码 "000000" 编码为：
0x00 0x00 0x00 0x00 0x00 0x00
```

### 3.6 校验和计算（BCC）
**简单加法累加**（不是异或）
```
BCC = sum(data[1] ... data[n-2])  // 从第2字节到倒数第2字节的累加和
取低8位
```

### 3.7 各命令帧格式详解

#### SET_TIME (0x10) — 设置时间
```
请求（10字节明文，key1加密）：
55 [cmdId] 10 [年] [月] [日] [时] [分] [秒] [BCC]

响应（4字节明文，key1加密）：
AA [cmdId] 10 [BCC]
```

#### AUTH_PASSWD (0x20) — 验证密码
```
请求（10字节明文，key2加密）：
55 [cmdId] 20 [D1] [D2] [D3] [D4] [D5] [D6] [BCC]
D1-D6 = 密码6位数字值（0x00-0x09）

响应（5字节明文，key2加密）：
AA [cmdId] 20 [结果] [BCC]
结果：0x00=密码正确，0x01=密码错误
```

#### SET_AUTH_PASSWD (0x21) — 修改密码
```
请求（10字节明文，key2加密）：
55 [cmdId] 21 [D1] [D2] [D3] [D4] [D5] [D6] [BCC]
D1-D6 = 新密码6位数字值

响应（5字节明文，key2加密）：
AA [cmdId] 21 [结果] [BCC]
结果：0x00=修改成功
```

### 3.8 密码存储
- 密码以3字节存储在Flash中（24位，最大999999）
- 出厂默认密码：000000
- 密码修改后立即写入Flash，断电不丢失
- 密码一次性配置，由管理员通过APP设置后绑定到客户平台

---

## 四、APP 对接修改要点

### 4.1 BLE 扫描
```java
// 扫描过滤：设备名称以 "LOCK_" 开头
// 不要使用精确匹配 setDeviceName("LOCK_")
// 使用空过滤器，在回调中前缀匹配

List<ScanFilter> filters = new ArrayList<>();  // 空列表
scanner.startScan(filters, settings, callback);

// 回调中过滤
if (name != null && name.startsWith("LOCK_")) {
    // 找到锁设备
}
```

### 4.2 BLE 连接后密钥生成
```java
// 连接成功后，从MAC地址生成key1
byte[] macBytes = parseMacAddress("E1:6A:9C:F1:F8:7E");
byte[] key1 = new byte[16];
System.arraycopy(macBytes, 0, key1, 0, 6);  // 直接复制，不要反转
key1[6] = 0x11;
for (int i = 7; i < 16; i++) {
    key1[i] = (byte)(key1[i-1] + 0x11);
}
```

### 4.3 AES 加密发送
```java
// 加密请求帧
public static byte[] encryptRequest(byte[] key, byte[] plainData) {
    byte[] frame = new byte[16];
    frame[0] = (byte) 0xFB;
    frame[1] = (byte) plainData.length;
    System.arraycopy(plainData, 0, frame, 2, plainData.length);
    for (int i = 2 + plainData.length; i < 16; i++) {
        frame[i] = (byte) 0xFC;  // 填充
    }
    // AES-128-ECB 加密，无填充
    Cipher cipher = Cipher.getInstance("AES/ECB/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"));
    return cipher.doFinal(frame);
}
```

### 4.4 密码修改示例代码
```java
// 步骤1：发送SET_TIME
Date now = new Date();
byte[] setTimeData = buildSetTimeRequest(cmdId++, now);
byte[] encrypted = encryptRequest(key1, setTimeData);
writeCharacteristic(encrypted);
// 收到响应后，用发送时的时间生成key2
key2 = generateKey2(key1, now);

// 步骤2：验证旧密码
byte[] authData = buildAuthRequest(cmdId++, oldPassword);
encrypted = encryptRequest(key2, authData);
writeCharacteristic(encrypted);
// 收到 payload=0x00 表示密码正确

// 步骤3：设置新密码
byte[] setPassData = buildSetPasswdRequest(cmdId++, newPassword);
encrypted = encryptRequest(key2, setPassData);
writeCharacteristic(encrypted);
// 收到 payload=0x00 表示修改成功

// 密码编码示例
private byte[] encodePassword(String password) {
    // "123456" → {0x01, 0x02, 0x03, 0x04, 0x05, 0x06}
    byte[] encoded = new byte[6];
    for (int i = 0; i < 6; i++) {
        encoded[i] = (byte)(password.charAt(i) - '0');  // 数值，不是ASCII
    }
    return encoded;
}
```

### 4.5 权限要求（Android 12+）
```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

```java
// Android 12+ 运行时权限请求
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    requestPermissions(new String[]{
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_CONNECT,
        Manifest.permission.ACCESS_FINE_LOCATION
    }, REQUEST_CODE);
}
```

---

## 五、平台对接要点

### 5.1 锁的唯一标识
- **BLE MAC地址**是全球唯一标识（6字节）
- 平台数据库中以MAC地址绑定锁号
- LoRa上报帧中包含MAC地址，平台可直接识别

### 5.2 网关数据解析（伪代码）
```python
def parse_lock_data(data):
    """
    解析锁上报数据（11字节）
    data: bytes, 网关收到的原始数据
    """
    addr_h = data[0]          # 锁E220地址高位
    addr_l = data[1]          # 锁E220地址低位
    channel = data[2]         # 锁E220信道
    mac = data[3:9]           # BLE MAC地址（6字节）
    status = data[9]          # 状态码
    battery = data[10]        # 电量百分比

    mac_str = ':'.join(f'{b:02X}' for b in mac)

    status_map = {
        0x01: '开锁',
        0x10: '关锁',
        0x11: '剪断报警'
    }

    return {
        'lock_addr': f'{addr_h:02X}{addr_l:02X}',
        'channel': channel,
        'mac': mac_str,
        'status': status_map.get(status, f'未知({status:02X})'),
        'battery': battery,
    }

# 示例
data = bytes([0x00, 0x08, 0x06, 0xE1, 0x6A, 0x9C, 0xF1, 0xF8, 0x7E, 0x10, 0x64])
result = parse_lock_data(data)
# {'lock_addr': '0008', 'channel': 6, 'mac': 'E1:6A:9C:F1:F8:7E', 'status': '关锁', 'battery': 100}
```

### 5.3 网关下发指令（伪代码）
```python
def build_lock_command(lock_e220_addr, lock_channel, lock_mac, command):
    """
    构建网关下发指令
    lock_e220_addr: (addr_h, addr_l) E220地址
    lock_channel: int, E220信道
    lock_mac: bytes, 6字节BLE MAC
    command: int, 0x01=开锁, 0x10=关锁
    """
    frame = bytes([
        lock_e220_addr[0], lock_e220_addr[1], lock_channel,  # 路由头（E220自动处理）
        *lock_mac,                                             # MAC校验
        command                                                # 指令
    ])
    return frame

# 开锁示例
mac = bytes([0xE1, 0x6A, 0x9C, 0xF1, 0xF8, 0x7E])
cmd = build_lock_command((0x00, 0x08), 0x06, mac, 0x01)
# 发送: 00 08 06 E1 6A 9C F1 F8 7E 01
gateway_uart_send(cmd)
```

---

## 六、系统行为说明

### 6.1 启动时序
```
按键唤醒 → BLE立即广播（红灯闪） → 8秒后LoRa启动（绿灯亮）
```
- BLE和LoRa同时工作，互不干扰
- BLE广播超时20秒无连接进入休眠
- LoRa启动后30秒无网关响应自动关闭

### 6.2 休眠与唤醒
- 无操作30秒自动休眠（LoRa活跃时）
- 无操作20秒自动休眠（仅BLE时）
- 按键唤醒，BLE和LoRa按时序自动启动
- 每24小时自动唤醒上报一次锁状态

### 6.3 关锁安全检测
LoRa网关关锁指令需满足两个硬件条件：
1. **lock_hall**（霍尔传感器）检测到锁杆到位
2. **STATE_KEY**（微动开关）检测到锁杆按压到位

两个条件同时满足才执行关锁动作，防止误操作。

### 6.4 密码管理
- 出厂默认密码：000000
- 密码为一次性配置，新锁由管理员通过APP修改
- 修改密码需先验证旧密码
- 密码存储在Flash中，断电不丢失
- 密码用于BLE连接认证，与LoRa通讯无关

---

## 七、固件修改的文件清单

| 文件 | 修改内容 |
|------|---------|
| `UserApp/lora_e220.c` | 全新LoRa E220驱动（替换原4G e103w08b） |
| `UserApp/lora_e220.h` | LoRa驱动头文件（引脚定义、结构体） |
| `UserApp/user_app.c` | BLE密码验证修改 + LoRa延迟启动 + 休眠时间调整 |
| `UserApp/input.c` | 无修改（保持原始开关锁逻辑） |
| `main.c` | 24小时定时上报（netUpLoadSendCnt） |
| `config.h` | 无修改 |
