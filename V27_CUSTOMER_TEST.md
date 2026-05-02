# v2.7 客户视角仿真测试报告

> 测试人员: 智云  
> 测试时间: 2026-05-02 14:15-14:30  
> 测试视角: member(小王) + company_admin(小李)  

---

## 场景模拟

鸿哥给客户公司「鸿哥测试公司」配了锁，客户员工「小王」拿到了账号：
- 账号：13900000003
- 密码：admin123
- 角色：member（一线操作员）
- 公司：鸿哥测试公司
- 班组：2班

小王打开浏览器，输入 `http://120.77.218.138`...

---

## 🔴 严重问题

### 1. 所有 PC 页面无前端路由守卫 — 任何人都能直接输 URL 访问

member 在浏览器直接输入以下 URL 全部能打开（返回 200）：

| 页面 | member 应该看到 | 实际 |
|------|:--:|:--:|
| `/dashboard` | ✅ | ✅ |
| `/devices` | ✅ | ✅ |
| `/alarms` | ✅ | ✅ |
| `/batches` | ❌ | ⚠️ 200 打开 |
| `/lock-numbers` | ❌ | ⚠️ 200 打开 |
| `/ble-debug` | ❌ | ⚠️ 200 打开 |
| `/companies` | ❌ | ⚠️ 200 打开 |
| `/users` | ❌ | ⚠️ 200 打开 |
| `/firmware` | ❌ | ⚠️ 200 打开 |
| `/integrations` | ❌ | ⚠️ 200 打开 |
| `/audit-logs` | ❌ | ⚠️ 200 打开 |
| `/permission-approvals` | ❌ | ⚠️ 200 打开 |
| `/temporary-approvals` | ❌ | ⚠️ 200 打开 |
| `/warehouses` | ❌ | ⚠️ 200 打开 |
| `/repairs` | ❌ | ⚠️ 200 打开 |
| `/authorizations` | ❌ | ⚠️ 200 打开 |
| `/devices/manage` | ❌ | ⚠️ 200 打开 |

**实际限制 = 零**。Sidebar 只是视觉隐藏，URL 直连无任何拦截。

### 2. API 层面部分缺 requireRole — member 能看到敏感数据

| API | member 看到什么 | 严重度 |
|-----|---------------|:---:|
| `GET /authorizations` | ⚠️ 14条授权记录（含其他 user 的姓名+设备） | 🔴 高 |
| `GET /companies` | ⚠️ 1个公司（自己公司，ok） | 🟡 中 |
| `GET /firmware/packages` | ⚠️ 固件列表（空，但不应可访问） | 🟡 中 |
| `GET /users` | ✅ FORBIDDEN（正确） | ✅ |
| `GET /production/batches` | ✅ FORBIDDEN（正确） | ✅ |
| `GET /audit-logs` | ✅ FORBIDDEN（正确） | ✅ |

**authorizations 是最严重的** — member 能看到所有授权记录，包括其他公司的人员姓名、设备号、授权时间。

### 3. 客户登录后个人信息缺失

小王登录后：
```
姓名: 测试员小王  ✅
角色: member       ✅  
公司: ?            ❌ 没返回公司名
班组: []           ❌ 没返回班组(虽然有 user_membership)
```

**影响：** 客户不知道自己属于哪个公司、哪个班组，体验断档。

---

## 🟡 一般问题

### 4. 客户看不到自己的设备门上写的什么

设备列表全部 `门=None` — 因为没有填 doorLabel。客户看到一堆锁号 `60500006, 60500007...` 不知道哪个是哪个门。

**改善：** 发运/分配时让 vendor 填写 doorLabel 说明

### 5. 客户没有"我的设备"概念

member 看到的是**班组所有设备**（6台），不知道"哪些是我负责的"。这是因为授权范围是 team 级别的。

**改善：** 
- team scope 下设备页面增加"全班组设备"标题
- 或者 support user scope 授权让 member 只能看自己的设备

### 6. member 能开所有班组锁

小王是 2班 member，能对 2班下任意设备发 unlock 命令。这在某些场景下是功能，但如果锁是"专人专锁"，这就不对了。

**改善：** 命令下发时检查：team scope 且 device assigned → 允许；否则检查 user scope

---

## ✅ 正常的部分

| 检查项 | 结果 |
|--------|:--:|
| member 不能创建设备 | ✅ |
| member 不能删除设备 | ✅ |
| member 不能创建用户 | ✅ |
| member 不能创建公司 | ✅ |
| member 不能看 audit-logs | ✅ |
| member 不能看批次数据 | ✅ |
| 除 authorizations 外，写操作全部受限 | ✅ |

---

## 修复优先级

| 优先级 | 问题 | 怎么修 |
|:---:|------|--------|
| 🔴 P0 | PC 页面无路由守卫 | Next.js middleware 或每页顶部 check role，member 访问无权限页 → 跳转 /dashboard |
| 🔴 P0 | /authorizations 泄露数据 | GET /authorizations 加 requireRole + scopeToCompany 过滤 |
| 🟡 P1 | 客户个人信息缺公司/班组 | /users/me 返回 company + memberships |
| 🟡 P1 | 无权限页面空白/报错体验差 | 加 <ForbiddenPage> 组件："您没有权限访问此页面" |
| 🟢 P2 | 客户不知道门号 | 发运时加 doorLabel 必填或后续补填 |
