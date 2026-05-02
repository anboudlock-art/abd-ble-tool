# v2.7 Bug 修复 + 客户子账号功能

> 代码仓库：`/root/abd-ble-tool`  
> 当前 commit：efabf90  
> 部署服务器：120.77.218.138 PM2

---

## 第一部分：Bug 修复（3 项）

### #1 /devices/manage 批次下拉无数据

**文件：** `apps/web/src/app/(app)/devices/manage/page.tsx` 第 88 行

**问题：** API 路径错误
```diff
- apiRequest<BatchListResp>('/api/v1/production-batches', {
+ apiRequest<BatchListResp>('/api/v1/production/batches', {
```

---

### #2 device-tree API 不返回 leaderName

**文件：** `apps/api/src/routes/device-management.ts`

**问题：** team 数据只返回 `{ id, name, deviceCount, memberCount }`，缺 leaderName

**修复：** teams 查询时 include leader 信息
```ts
teams: {
  where: { deletedAt: null },
  select: { 
    id: true, 
    name: true,
    leaderUserId: true,  // ← 新增
    leader: { select: { name: true } }  // ← 新增
  },
  orderBy: { id: 'asc' },
},
```
然后 map 时返回：
```ts
return {
  id: tid,
  name: t.name,
  deviceCount: deviceByTeam.get(tid) ?? 0,
  memberCount: memberByTeam.get(tid) ?? 0,
  leaderName: t.leader?.name ?? null,  // ← 新增
};
```

---

### #3 vendor_admin 访问 /devices/manage 报错

**文件：** `apps/api/src/routes/device-management.ts` 第 36-40 行

**问题：** vendor_admin 必须传 `?companyId=`，但 vendor 自己没有 companyId，直接报 409

**修复：** vendor_admin 不传 companyId 时，返回所有非 vendor 公司的聚合树（或给 vendor 一个默认公司）
```ts
if (targetCompanyId == null) {
  // vendor without companyId → return summary of all customer companies
  // 或者更简单的：在 manage page 自动选第一个公司
}
```
或者更简单的方案：manage page 初始化时自动选第一个公司：
在 `apps/web/src/app/(app)/devices/manage/page.tsx` 第 55 行确保 auto-select 逻辑在 tree 查询前生效。

---

## 第二部分：客户子账号系统（新功能）

### 需求说明

鸿哥作为 vendor_admin（厂商）给客户公司创建子账号：
1. 创建公司时/后，自动生成 company_admin 账号
2. 账号用手机号+自动生成密码（或指定初始密码）
3. 客户登录后看到的界面和 vendor 一样，但**不显示生产环节**
4. vendor_admin 在自己的账号中点击客户公司就能**切换视角**进入该客户的视图

---

### 需要修改的内容

#### A. 创建公司时自动创建管理员

**文件：** `apps/api/src/routes/companies.ts` 的 `POST /companies`

当前创建公司只建 company 表。改为：
1. 必填：`adminPhone`, `adminName`
2. 创建公司 → 自动创建 `role=company_admin` 的用户
3. 用 `generateTempPassword()` 生成初始密码
4. 响应里返回 `{ company, adminAccount: { phone, initialPassword } }` 让 vendor 发给客户

```ts
// Schema 新增字段
export const CreateCompanySchema = z.object({
  name: z.string().min(1).max(128),
  code: z.string().max(32).optional(),
  // 新增：管理员信息
  adminPhone: z.string().regex(phoneRegex),
  adminName: z.string().min(1).max(64),
  adminPassword: z.string().min(6).max(64).optional(), // 不传则自动生成
});
```

创建流程：
1. `prisma.company.create(...)`
2. 生成/使用密码
3. `prisma.user.create({ companyId, phone, name, role: 'company_admin', passwordHash })`
4. 返回 `{ company, adminAccount: { phone, name, initialPassword } }`

---

#### B. 密码逻辑（已有基础）

当前代码已支持：
- `generateTempPassword()` — 已实现
- `initialPassword` 字段 — 已创建但未在创建公司时使用
- `POST /users/:id/reset-password` — 已有重置密码端点
- 密码哈希：`bcrypt` 已集成
- 首次登录改密：token 中有 `mustChangePassword` 但**未实现**（见 C 项）

---

#### C. 首次登录强制改密

**文件：** `apps/api/src/routes/auth.ts`

当前 auth token 没有 `mustChangePassword` 标志，需要：
1. User 表加字段 `mustChangePassword BOOLEAN DEFAULT FALSE`
2. 创建用户时设 `mustChangePassword: true`
3. 登录接口检测该字段，token 中加 `mustChangePassword: true`
4. 前端检测 token → 弹窗跳转到改密页面
5. 新增 `POST /auth/change-password` 端点，改完置 `false`

```prisma
// schema.prisma: User 加字段
mustChangePassword Boolean @default(false) @map("must_change_password")
```

```ts
// auth.ts login 路由
if (user.mustChangePassword) {
  return { 
    accessToken, 
    mustChangePassword: true,
    user: { id, name, role, ... }
  };
}
```

---

#### D. vendor_admin 切换客户视角

**核心需求：** vendor_admin 在平台里点一个客户公司，就能"成为"那个公司的 company_admin，看到客户能看到的界面。

**实现方案有两个：**

**方案 1（推荐）：URL 参数切换**
- 顶部导航加公司选择器 `<select>`
- 选中的公司 ID 存到 URL query `?viewAsCompany=5`
- 所有 API 请求带上这个 header 或 query
- API 中间件检测 `req.headers['x-view-as-company-id']`，如果当前用户是 vendor_admin，则以该公司的 scope 查询

**文件改动：**
1. `apps/web/src/components/Sidebar.tsx` — 顶部加公司切换器
2. `apps/web/src/lib/api.ts` — 所有请求自动带 `X-View-As-Company: <id>`
3. `apps/api/src/lib/auth.ts` — `scopeToCompany()` 检测 vendor_admin + 切换头，覆盖 companyId
4. 所有受 scope 影响的 API（devices, teams, departments, authorizations 等）自动适配

**方案 2（简化）：Impersonate Token**
- vendor 点击公司 → 生成一个有时效的 company_admin 临时 token
- 前端替换 token 重新登录 → 看到客户视角
- 退出切换 → 恢复 vendor token

方案 1 改动更少，推荐用方案 1。

---

#### E. 新用户欢迎流程

给客户发账号信息时：
```
公司：鸿哥测试公司
登录地址：https://admin.abdlock.cn（IP: 120.77.218.138）
账号：138xxxx0000
初始密码：aB3xK9mP
首次登录需修改密码
```

---

## 📊 涉及文件汇总

### Bug 修复
| 文件 | 改动 |
|------|------|
| `apps/web/.../devices/manage/page.tsx` | #1 路径修正 |
| `apps/api/.../device-management.ts` | #2 加 leaderName |
| `apps/web/.../devices/manage/page.tsx` | #3 自动选第一个公司 |

### 新功能
| 文件 | 改动 |
|------|------|
| `packages/shared/src/schemas.ts` | CreateCompanySchema 加 adminPhone/adminName |
| `apps/api/src/routes/companies.ts` | POST /companies 创建管理员 |
| `packages/db/prisma/schema.prisma` | User 加 mustChangePassword |
| `apps/api/src/routes/auth.ts` | login 返回 mustChangePassword |
| `apps/api/src/lib/auth.ts` | scopeToCompany 接入 vendor viewAs |
| `apps/web/src/lib/api.ts` | 请求头带 X-View-As-Company |
| `apps/web/src/components/Sidebar.tsx` | 顶部公司切换器 |
| `apps/web/.../devices/manage/page.tsx` | 公司选择器已有，需联动 |

---

*2026-05-02 14:30 CST*
