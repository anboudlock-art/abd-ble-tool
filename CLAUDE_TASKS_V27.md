# v2.7 修改任务清单

> 代码仓库：`/root/abd-ble-tool`
> 部署方式：PM2 (abd-api, abd-web, abd-worker)
> API 前缀：`/api/v1`
> 服务器：120.77.218.138
> 当前 commit：bbd681e (代码已还原至此干净版本，可放心改)

---

## 修改概览（8 项）

| # | 分类 | 修改点 | 涉及文件 |
|---|------|--------|----------|
| 1 | 前端 | 侧边栏按功能区重组（4个分组，折叠子菜单） | `Sidebar.tsx` |
| 2 | 全栈 | 设备列表加批次筛选下拉框 | `schemas.ts` + `devices.ts(api)` + 2个 page.tsx |
| 3 | API | 设备列表支持 `currentDepartmentId` 过滤 | `schemas.ts` + `devices.ts(api)` |
| 4 | 全栈 | 新建设备管理页 `/devices/manage`（左树右表） | `app.ts` + 新建5个文件 |
| 5 | 前端 | 设备详情页加「撤销授权」按钮 | `devices/[id]/page.tsx` |
| 6 | 前端 | 设备列表电量百分比加颜色编码 | `devices/page.tsx` |
| 7 | 前端 | 操作日志 actorName 显示修复 | audit-logs 页面 |
| 8 | API | Dashboard recentDevices 补数据 | `dashboard.ts` |
| 9 | 运维 | nginx 加 admin.abdlock.cn 域名 | `/etc/nginx/sites-enabled/abdlock` |

---

## 1. 侧边栏重构

**文件：** `apps/web/src/components/Sidebar.tsx`

**当前：** 17个平铺菜单项，按角色过滤显示

**改为：** 4个分组，子菜单折叠

### 新结构：
```
🏠 概览                              (全角色可见)

🏭 厂商功能                           (vendor_admin/production_operator)
  ├ 三库总览
  └ 维修中库

📦 生产环节 ▸  [可折叠，默认收起]     (vendor_admin/production_operator)
  ├ 生产批次
  ├ 锁号生成
  └ BLE调试

🔧 运维功能                           (全角色，member 只看到设备和告警)
  ├ 设备
  ├ 设备管理                         (team_leader及以上)
  ├ 权限审批                         (dept_admin及以上)
  ├ 临开审批                         (team_leader及以上)
  └ 告警

⚙️ 管理设置 ▸  [可折叠，默认收起]     (team_leader及以上)
  ├ 客户公司                         (vendor_admin 专属)
  ├ 人员
  ├ 对接 API                         (company_admin及以上)
  ├ 固件 OTA                         (company_admin及以上)
  └ 操作日志                         (company_admin及以上)
```

### 角色可见性完整映射：
| 菜单 | vendor_admin | production_operator | company_admin | dept_admin | team_leader | member |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| 概览 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 三库总览 | ✅ | ✅ | | | | |
| 维修中库 | ✅ | ✅ | ✅ | | | |
| 生产批次 | ✅ | ✅ | | | | |
| 锁号生成 | ✅ | | | | | |
| BLE调试 | ✅ | ✅ | | | | |
| 设备 | ✅ | | ✅ | ✅ | ✅ | ✅ |
| 设备管理 | ✅ | | ✅ | ✅ | ✅ | |
| 权限审批 | ✅ | | ✅ | ✅ | | |
| 临开审批 | ✅ | | ✅ | ✅ | ✅ | |
| 告警 | ✅ | | ✅ | ✅ | ✅ | ✅ |
| 客户公司 | ✅ | | | | | |
| 人员 | ✅ | | ✅ | ✅ | ✅ | |
| 对接API | ✅ | | ✅ | | | |
| 固件OTA | ✅ | | ✅ | | | |
| 操作日志 | ✅ | | ✅ | | | |

### 实现提示：
- 使用 `CollapsibleSection` 组件，点击标题展开/折叠
- 折叠箭头：展开时向下 `rotate-0`，折叠时向左 `-rotate-90`
- 未激活项用 `hover:bg-slate-100`，激活项 `bg-slate-900 text-white`

---

## 2. 设备列表加批次筛选

**改 4 个文件：**

### 2a. Shared Schema
**文件：** `packages/shared/src/schemas.ts`

在 `DeviceListQuerySchema` 中新增一行：
```ts
batchId: z.coerce.number().int().positive().optional(),
```

### 2b. API 查询
**文件：** `apps/api/src/routes/devices.ts`

`GET /api/v1/devices` 的 `where` 条件里加：
```ts
...(batchId ? { batchId: BigInt(batchId) } : {}),
```

**解构参数时也要加上 `batchId`：**
```ts
const { page, pageSize, status, modelId, ownerCompanyId, currentTeamId, batchId, search } = req.query;
```

### 2c. 前端 /devices 页面
**文件：** `apps/web/src/app/(app)/devices/page.tsx`

1. 筛选区加「批次」`<select>` 下拉框
2. 调用 `GET /api/v1/production/batches?pageSize=200` 获取批次列表
3. 下拉 label：`B20260501-001 · 600个`（批号+计划数量）
4. 选中后 `setBatchId(e.target.value)`，重置 page 到 1
5. queryKey 里加上 `batchId`

### 2d. 前端 /devices/manage 页面（见任务4）
同理加批次下拉

---

## 3. 设备列表 API 支持 currentDepartmentId

**改 2 个文件：**

### 3a. Shared Schema
**文件：** `packages/shared/src/schemas.ts`

同上，再加一行：
```ts
currentDepartmentId: z.coerce.number().int().positive().optional(),
```

### 3b. API
**文件：** `apps/api/src/routes/devices.ts`

`where` 条件里加（放在 `currentTeamId` 之后）：
```ts
...(currentDepartmentId ? { currentTeam: { departmentId: BigInt(currentDepartmentId) } } : {}),
```

解构参数时加上 `currentDepartmentId`

---

## 4. 新建设备管理页 `/devices/manage`

**需要新建/修改 6 个文件：**

### 4a. API 路由注册
**文件：** `apps/api/src/app.ts`

新增：
```ts
import deviceManagementRoutes from './routes/device-management.js';
await app.register(deviceManagementRoutes, { prefix: '/api/v1' });
```

### 4b. device-tree API
**文件（新建）：** `apps/api/src/routes/device-management.ts`

**端点：** `GET /api/v1/device-tree?companyId=`

返回结构：
```json
{
  "id": "5",
  "name": "鸿哥测试公司",
  "deviceCount": 3,
  "departments": [{
    "id": "2",
    "name": "水电部",
    "deviceCount": 3,
    "teams": [{
      "id": "2",
      "name": "2班",
      "memberCount": 5,
      "deviceCount": 3
    }]
  }]
}
```

**权限：** vendor_admin 通过 `?companyId=` 查任意公司；company_admin/dept_admin/team_leader 自动用 `scope.companyId` 锁定自己公司

**关键查询逻辑：**
- `prisma.company.findUnique` + `prisma.department.findMany` + `prisma.team.findMany`
- 每个 team 用 `prisma.device.count({ where: { currentTeamId, deletedAt: null } })` 算设备数
- 每个 team 用 `prisma.userMembership.count({ where: { teamId } })` 算人员数
- 部门 deviceCount = 下属所有 team 的 deviceCount 之和

### 4c. OrgTree 组件
**文件（新建）：** `apps/web/src/components/OrgTree.tsx`

**入参：**
```ts
interface Props {
  tree: OrgNode | null;
  selected: { type: 'company' | 'department' | 'team'; id: string; name: string } | null;
  onSelect: (node: SelectedNode) => void;
}
```

**行为：**
- 公司节点：显示名称 + 设备总数 badge
- 部门节点：可折叠，显示名称 + 下属设备总数
- 班组节点：显示名称 + 人数 + 设备数
- 点击节点高亮，回调 `onSelect`
- 默认展开第一个部门

### 4d. AuthorizeDialog 组件
**文件（新建）：** `apps/web/src/components/AuthorizeDialog.tsx`

**入参：**
```ts
interface Props {
  selectedDeviceIds: string[];
  fixedCompanyId?: string;   // 自动锁定公司，vendor_admin 侧选公司时传入
  fixedTeamId?: string;      // 从班组节点自动带入
  onClose: () => void;
  onSuccess: () => void;
}
```

**两步布局：**
- Step 1「谁」：公司 → 部门 → 班组 → 人（可选，选班组即授权整班组）
- Step 2「范围」：显示已选设备数、原因、有效期
- 提交调用 `POST /api/v1/authorizations`（已存在）

### 4e. 主页面
**文件（新建）：** `apps/web/src/app/(app)/devices/manage/page.tsx`

**布局：**
```
┌── 左侧 220px ───┬── 右侧设备面板 ───────────────────┐
│ 组织树           │ 🏠 公司 / 部门 / 班组 (面包屑)     │
│                 │ 共 N 台      [🔑授权选中] [取消授权]│
│                 │ [🔍搜索] [批次▼] [状态▼]           │
│                 │ ┌───────────────────────────────┐  │
│                 │ │ ☑ | 锁号 | 门号 | MAC | 班组/人 | 状态 | 电量 | 上报 │
│                 │ └───────────────────────────────┘  │
└─────────────────┴──────────────────────────────────┘
```

**核心功能：**
- 左侧 OrgTree，点击节点 → 右侧显示对应设备
  - 点公司 → 全部设备（不过滤 teamId/departmentId）
  - 点部门 → `currentDepartmentId` 过滤
  - 点班组 → `currentTeamId` 过滤
- 面包屑导航
- 设备表格列：锁号(链接可点)、门号、BLE MAC、**班组/人员**、状态、电量(颜色编码)、最近上报
- 批量授权：勾选设备 → 弹出 AuthorizeDialog（自动带班组上下文）
- 取消授权：勾选已授权设备 → 调 `POST /authorizations/:id/revoke`（需先查当前 assignment）
- 搜索框 + 批次筛选 + 状态筛选
- vendor_admin 顶部有公司选择器切换客户公司视图
- 分页

**电量颜色编码：** `<20% → text-rose-500，20-50% → text-amber-500，>50% → text-emerald-600`

### 4f. Sidebar 加菜单项
**文件：** `apps/web/src/components/Sidebar.tsx`

在运维功能分组中加入：
```ts
{ href: '/devices/manage', label: '设备管理', icon: UsersRound },
```

---

## 5. 设备详情页加撤销授权

**文件：** `apps/web/src/app/(app)/devices/[id]/page.tsx`

在设备详情页授权信息展示区域（大概 231 行附近）：
1. 加「撤销授权」按钮（仅在有 `assignmentQ.data?.current` 时显示）
2. 点击 → `useMutation` 调用 `POST /api/v1/authorizations/${assignmentId}/revoke`
3. 成功后 `qc.invalidateQueries` 刷新 assignment

---

## 6. 设备列表电量颜色编码

**文件：** `apps/web/src/app/(app)/devices/page.tsx`

在设备表格的电量 `<Td>` 中，给数值加颜色：
```tsx
<span className={clsx(
  'text-xs font-medium',
  d.lastBattery < 20 ? 'text-rose-500' :
  d.lastBattery < 50 ? 'text-amber-500' :
  'text-emerald-600'
)}>
  {d.lastBattery}%
</span>
```

---

## 7. 操作日志 actorName 显示修复

**文件：** `apps/web/src/app/(app)/audit-logs/page.tsx`

当前 API 返回 `actor: { name: "xxx" }` 嵌套对象，但前端可能没正确渲染。
检查并修复：确保表格「操作人」列渲染的是 `item.actor?.name ?? '—'` 而不是 `item.actorName`

---

## 8. Dashboard recentDevices 补数据

**文件：** `apps/api/src/routes/dashboard.ts`

**问题：** `recentDevices` 查询条件是 `lastSeenAt: { not: null }`，但虚拟锁没有上报过数据所以全空。

**修复：** 改为取最近创建的设备（无 lastSeenAt 时降级）：
```ts
prisma.device.findMany({
  where: deviceWhere,
  orderBy: { updatedAt: 'desc' },
  take: 6,
  select: { id: true, lockId: true, status: true, lastBattery: true, lastSeenAt: true },
});
```

---


## 📊 新建文件清单

| 文件 | 说明 |
|------|------|
| `apps/api/src/routes/device-management.ts` | GET /api/v1/device-tree |
| `apps/web/src/components/OrgTree.tsx` | 可折叠组织树组件 |
| `apps/web/src/components/AuthorizeDialog.tsx` | 授权弹窗（人先选型） |
| `apps/web/src/app/(app)/devices/manage/page.tsx` | 设备管理主页面 |

## 📝 需修改的现有文件

| 文件 | 改动内容 |
|------|----------|
| `packages/shared/src/schemas.ts` | DeviceListQuerySchema 加 batchId + currentDepartmentId |
| `apps/api/src/app.ts` | 注册 device-management 路由 |
| `apps/api/src/routes/devices.ts` | 加 batchId/currentDepartmentId 查询、CSS inject、newUserPassword |
| `apps/api/src/routes/dashboard.ts` | recentDevices 改用 updatedAt 降级 |
| `apps/web/src/components/Sidebar.tsx` | 完全重写为分组折叠布局 |
| `apps/web/src/app/(app)/devices/page.tsx` | 加批次下拉 + 电量颜色 |
| `apps/web/src/app/(app)/devices/[id]/page.tsx` | 加撤销授权按钮 |

---

*文档生成：2026-05-02 12:00 CST*
*下一步：鸿哥审核后发给 Claude 开始编码*
