# v2.7 仿真测试 + bug 修复 + 客户子账号 + 权限安全

> 测试时间: 2026-05-02 14:00-14:30  
> 测试人: 智云  
> 代码仓库: `/root/abd-ble-tool`  
> 部署服务器: 120.77.218.138 PM2  

---

## 一、🐛 Bug 修复（3 项）

### #1 /devices/manage 批次下拉无数据

**文件:** `apps/web/src/app/(app)/devices/manage/page.tsx` 第 88 行  
**问题:** API 路径错误 `production-batches` → 404
```diff
- apiRequest<BatchListResp>('/api/v1/production-batches', {
+ apiRequest<BatchListResp>('/api/v1/production/batches', {
```

### #2 device-tree API 不返回 leaderName

**文件:** `apps/api/src/routes/device-management.ts`

teams 查询加 leader 信息：
```ts
teams: {
  where: { deletedAt: null },
  select: { 
    id: true, name: true,
    leaderUserId: true,          // 新增
    leader: { select: { name: true } }  // 新增
  },
},
```
map 时返回 `leaderName: t.leader?.name ?? null`

### #3 vendor_admin 访问 /devices/manage 报错

vendor_admin 不传 companyId 时报 409。修复：**manage page 初始化自动选第一个客户公司**，确保 tree 查询永远有 companyId。

---

## 二、🔴 权限安全漏洞（P0，必须先修）

### 问题 4：所有 PC 页面无前端路由守卫

member 通过直接改 URL 可以访问所有后台页面（生产批次、锁号、固件、人员、日志等），Sidebar 只做了视觉隐藏。

**修复方案：**
1. 在 `apps/web/src/middleware.ts` 或 `apps/web/src/app/(app)/layout.tsx` 加前端路由守卫
2. 根据 `user.role` 校验当前路由的 requiredRoles
3. member 访问 `/batches`, `/lock-numbers`, `/companies`, `/users`, `/firmware`, `/integrations`, `/audit-logs`, `/permission-approvals`, `/temporary-approvals`, `/warehouses`, `/repairs`, `/authorizations`, `/devices/manage` → 跳转 `/dashboard` + Toaster "无权限访问"
4. `/ble-debug` 同理

**实现提示：** 在 `layout.tsx` 加一个 `ProtectedRoute` 组件，定义每页的 requiredRoles map，不匹配就 redirect

### 问题 5：/authorizations API 无权限过滤，member 能看到所有授权

member (13900000003) 调用 `GET /authorizations` 返回 14 条记录，含其他公司的用户姓名和设备号。

**修复：** `apps/api/src/routes/authorizations.ts`
- GET 路由加 `requireRole('vendor_admin', 'company_admin', 'dept_admin', 'team_leader')`
- 加 `scopeToCompany()` 过滤 companyId

### 问题 6：/users/me 不返回公司名和班组

member 登录后看不到自己属于哪个公司、哪个班组。

**修复：** `apps/api/src/routes/users.ts` GET /users/me
```ts
const u = await prisma.user.findUnique({
  where: { id: ctx.userId },
  include: {
    company: { select: { id: true, name: true } },
    memberships: {
      include: { team: { select: { id: true, name: true, department: { select: { id: true, name: true } } } } },
    },
  },
});
```

---

## 三、🟡 其他体验问题

### 7. memberCount=0
原因: user_membership 表没有自动填充。创建用户时 teamId 不为空应自动插入 user_membership。

**修复：** `apps/api/src/routes/users.ts` POST /users
```ts
if (teamId) {
  await prisma.userMembership.create({ data: { userId: user.id, teamId } });
}
```

### 8. 设备电量全 null
test-create 不设 lastBattery，仿真环境电量颜色不触发。可加 battery 参数（默认随机）。

### 9. test-create 跳过 manufactured 状态
activate=false 直接 in_warehouse，缺失 manufactured 阶段。

---

## 四、客户子账号系统（新功能）

### 需求
鸿哥给客户公司创建子账号 → 客户登录 → 看到和 vendor 一样的简洁界面 → 但没有生产环节菜单 → vendor_admin 能一键切换到客户视角

### A. 创建公司 = 创建管理员

**文件:** `apps/api/src/routes/companies.ts`
- CreateCompanySchema 加 `adminPhone`, `adminName`, `adminPassword?`
- 创建公司后自动建 role=company_admin 的用户
- 不传密码则 `generateTempPassword()` 自动生成
- 响应返回 `{ company, adminAccount: { phone, name, initialPassword } }`

### B. 首次登录强制改密

**文件:** `packages/db/prisma/schema.prisma`
```prisma
model User {
  // ...existing fields...
  mustChangePassword Boolean @default(true) @map("must_change_password")
}
```
**文件:** `apps/api/src/routes/auth.ts` — login 返回 `mustChangePassword: true`
**文件:** `apps/web` — 检测 mustChangePassword → 弹窗跳改密页

### C. vendor 切换客户视角

vendor_admin 可以一键"切到"某个客户公司看他们的界面：
1. Sidebar 顶部加 `<select>` 公司切换器
2. 选公司 → 所有 API 请求自动带 `X-View-As-Company: <id>` header
3. API 中间件 `scopeToCompany()` 检测 vendor + 该 header → 覆盖 companyId scope
4. Sidebar 根据切换后的公司重新渲染（去掉生产 + 厂商分组）

**涉及文件：**
| 文件 | 改动 |
|------|------|
| `apps/web/src/components/Sidebar.tsx` | 顶部公司下拉 + viewedCompany 状态 |
| `apps/web/src/lib/api.ts` | 请求注入 X-View-As-Company header |
| `apps/api/src/lib/auth.ts` | scopeToCompany 读取 header |
| `apps/web/src/app/(app)/layout.tsx` | 提供 ViewedCompanyContext |

---

## 五、📊 全部涉及文件一览

### Bug 修复
| 文件 | 改动项 |
|------|--------|
| `apps/web/.../devices/manage/page.tsx` | #1 路径 #3 自动选公司 |
| `apps/api/.../device-management.ts` | #2 加 leaderName |

### 权限修复
| 文件 | 改动项 |
|------|--------|
| `apps/web/src/app/(app)/layout.tsx` | #4 路由守卫 |
| `apps/api/.../authorizations.ts` | #5 加 requireRole + scope |
| `apps/api/.../users.ts` | #6 返回 company + memberships, #7 自动插入 user_membership |

### 新功能
| 文件 | 改动项 |
|------|--------|
| `apps/api/.../companies.ts` | A 创建公司=建管理员 |
| `packages/db/prisma/schema.prisma` | B mustChangePassword 字段 |
| `apps/api/.../auth.ts` | B login 返回 mustChangePassword |
| `apps/web/src/lib/api.ts` | C 注入 view header |
| `apps/api/.../auth.ts` (scopeToCompany) | C vendor view 切换 |
| `apps/web/src/components/Sidebar.tsx` | C 公司切换器 |

---

*生成时间: 2026-05-02 15:10 CST*
