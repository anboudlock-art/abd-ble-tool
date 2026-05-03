# Claude Tasks — User & Device Flow Fix (v2.8.1)

**Generated:** 2026-05-03  
**Author:** 云智 (spec writer)  
**Code:** Claude (sole impl)  

---

## Overview

Customer companies (子账号) need a complete device lifecycle experience, matching vendor admin (总账户) capabilities minus production/manufacturing features.

**Design principle:** 子账号 = 总账户 - 生产功能 - 对接API - 固件OTA

---

## Task 1 [P0]: Edit User — Role / Name / Status

### Problem
User list has 新建/重置密码/删除 but no edit button. Company admin cannot change user roles. `UpdateUserSchema` is missing `role` field.

### Fix — Schema
`packages/shared/src/schemas.ts` → `UpdateUserSchema`:
```ts
export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  email: z.string().email().max(128).optional().nullable(),
  employeeNo: z.string().max(32).optional().nullable(),
  role: z.enum([
    'company_admin',
    'dept_admin', 
    'team_leader',
    'member',
  ]).optional(),
  status: z.enum(['active', 'locked']).optional(),
});
```
Note: company_admin can only assign roles up to their own level (no vendor_admin, no production_operator).

### Fix — API
`apps/api/src/routes/users.ts` → `PUT /users/:id`:
- Already writes role from body. Add guard: company_admin cannot promote to vendor_admin.
- Return updated user with role.

### Fix — Web
`apps/web/src/app/(app)/users/page.tsx`:
- Add "编辑" button in action column
- Modal form: name, phone, role (dropdown, filtered by allowed roles), status
- Submit: `PUT /users/:id`

---

## Task 2 [P0]: Device Receiving — "确认收货" in Detail Page

### Problem
`shipped` devices appear in company_admin's view but there's no "确认收货" button in the detail page. The batch "确认入库" only exists in device list multi-select.

### Fix
`apps/web/src/app/(app)/devices/[id]/page.tsx`:
- When `status === 'shipped'` AND user's companyId === device.ownerCompanyId: show "确认收货" button
- Button calls `POST /api/v1/devices/deliver` with `{ deviceIds: [id] }`
- On success → status becomes `delivered`, refetch detail

`apps/web/src/app/(app)/devices/page.tsx`:
- `selectedDeliverable` filter already uses `shipped`
- Confirm company_admin can select/deliver shipped devices
- Fix line 124: `selectableIds` for `canDeliver` role must include `shipped`

---

## Task 3 [P1]: Device Assigning — "分配授权" in Detail Page

### Problem
After `delivered`, company admin needs to assign device to trigger `assigned` status.

### Fix
`apps/web/src/app/(app)/devices/[id]/page.tsx`:
- When `status === 'delivered'` AND user is company_admin: show "分配授权" button
- Reuse existing AssignDialog component → assign to team or user → status becomes `assigned`
- Show current assignment info block after assign

---

## Task 4 [P1]: RemoteControl Prompt — Model-Specific

### Problem
4G lock shows `"需在 assigned/active 状态且为 LoRa 型号才能远程控制"` — wrong, it's 4G not LoRa.

### Fix
`apps/web/src/components/RemoteControl.tsx`:
```tsx
const protocol = device.model?.hasLora ? 'LoRa 型号' : '4G 联网';
// Use in both enabled and disabled messages
```
- Enabled: `指令通过 {LoRa网关/4G网络}下发`
- Disabled: `设备需在 assigned/active 状态且为{4G联网/LoRa型号}才能远程控制`

---

## Task 5 [P0]: Sidebar — Customer Company Menu Restructure

### Problem
- `对接API` and `固件OTA` shouldn't be visible to company_admin
- No "维修中库" for customer companies
- No "使用中库" concept for customer companies

### Fix — Sidebar
`apps/web/src/components/Sidebar.tsx`:

1. **Remove from company_admin:**
   - `对接API`: change roles from `['vendor_admin', 'company_admin']` → `['vendor_admin']`
   - `固件OTA`: change roles from `['vendor_admin', 'company_admin']` → `['vendor_admin']`

2. **Add to "运维功能" group:**
   - `使用中库` URL: `/devices?status=active,assigned,delivered,shipped`  
     roles: `['company_admin', 'dept_admin', 'team_leader']`

3. **Add "维修管理" section for company_admin:**
   - New group between "运维功能" and "管理设置":
   ```tsx
   {
     groupId: 'repair-mgmt',
     groupLabel: '🔧 维修管理',
     groupRoles: ['company_admin', 'dept_admin', 'team_leader'],
     items: [
       {
         href: '/repairs',
         label: '维修中库',
         icon: Wrench,
         roles: ['company_admin', 'dept_admin', 'team_leader'],
       },
     ],
   },
   ```
   - REPLACE the existing `repairs` entry that's under `vendor` group

4. **Vendor 维修中库:** Keep in vendor group, but make it show ALL companies' repairs

### Sidebar Result

**子账号 (company_admin):**
```
🔧 运维功能
├── 设备（概览）
├── 使用中库
├── 设备管理
├── 授权管理
├── 权限审批
├── 临开审批
├── 告警
🔧 维修管理
├── 维修中库
管理员工具
├── 人员
├── 操作日志
```

**总账户 (vendor_admin):** unchanged + sees all repairs

---

## Task 6 [P1]: Customer Repair Request Flow

### Problem
No way for customer to initiate a repair. Repair intake (`POST /devices/:id/repair-intake`) exists but no frontend entry point for company users.

### Database
`device_repair` table already has all needed fields. Add one:
- `fault_category_id` BIGINT (nullable, FK to new fault_category table)

### New Table: `fault_category`
```sql
CREATE TABLE fault_category (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  label VARCHAR(128) NOT NULL,        -- e.g. "无法充电"
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Seed data — common faults (鸿哥 to provide final list):
```
1. 无法开锁
2. 无法关锁  
3. 电池不充电
4. 蓝牙连接失败
5. 4G 信号弱/离线
6. GPS 定位不准
7. 锁体损坏
8. 其他
```

### Fix — API
`apps/api/src/routes/repairs.ts`:

1. **POST /devices/:id/repair-intake** — extend to accept `faultCategoryId` and `notes`:
   ```ts
   body: {
     faultCategoryId?: number,
     notes?: string,
   }
   ```

2. **GET /fault-categories** — list active fault categories (all roles)

3. **GET /repairs** — company_admin scope: only show repairs from their company

### Fix — Web

1. **"报修" button in device detail page:**
   `apps/web/src/app/(app)/devices/[id]/page.tsx`:
   - When user is company_admin and device belongs to their company: show "报修" button
   - Opens RepairRequestDialog

2. **RepairRequestDialog component (new):**
   `apps/web/src/components/RepairRequestDialog.tsx`:
   - Dropdown: fault category (from GET /fault-categories)
   - Textarea: notes (optional)
   - Submit: `POST /devices/:id/repair-intake`
   - On success: device status → `repairing`, closes dialog

3. **维修中库 page:** Update to filter by company for company_admin
   - Vendor: sees ALL repairs
   - Company admin: sees only own company's repairs

### Repair Flow (End to End)
```
客户侧：
1. 设备详情页 → 点"报修"
2. 选故障类型(下拉勾选) → 填备注 → 提交
3. 设备自动入"维修中库"（客户可见）
4. 客户寄回锁

总账户侧：
5. 维修中库看到新维修单 → 点"确认收到" → 状态变 diagnosing
6. 维修 → 状态更新 → repaired
7. 修好后自动移回待移交区 → 重新发货给客户
```

---

## Task 7 [P2]: Company Detail Page — Device Card

### Fix
`apps/web/src/app/(app)/companies/[id]/page.tsx`:
- Add "设备清单" card at bottom
- Query `GET /api/v1/devices?ownerCompanyId={id}`
- Table: lock_id, model, status (badge), last_seen_at
- Link rows to `/devices/{id}`

---

## Summary

| # | Priority | What | Where |
|---|----------|------|-------|
| 1 | P0 | Edit user (role/name/status) | schema + api + users page |
| 2 | P0 | "确认收货" in device detail | devices/[id] + devices list |
| 3 | P1 | "分配授权" in device detail | devices/[id] |
| 4 | P1 | RemoteControl model-specific prompt | RemoteControl.tsx |
| 5 | P0 | Sidebar restructure + repair entry | Sidebar.tsx |
| 6 | P1 | Customer repair flow | repairs API + device detail + new component |
| 7 | P2 | Company detail device card | companies/[id] |

## Notes
- Task 1: `UpdateUserSchema` role enum should NOT include vendor_admin or production_operator (company_admin can't assign those)
- Task 5-6: Sidebar "维修中库" already exists at `/repairs` for vendor; need to scope by company for company_admin
- `device_repair` table already has all status flow fields (intake→diagnosing→repairing→repaired)
- No DB migration needed for tasks 1-5, only Task 6 adds fault_category table
