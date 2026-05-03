# Claude Tasks — User & Device Flow Fix (v2.8.1)

**Generated:** 2026-05-03 22:55  
**Author:** 云智 (spec writer)  
**Code:** Claude (sole impl)  

---

## Task 1 [P0]: Edit User — Role / Name / Status / Phone

### Problem
User list shows members but no edit button. Company admin cannot change user role (member→company_admin, etc.), name, or status. API `PUT /users/:id` exists but `UpdateUserSchema` is missing `role` field.

### Fix — Schema
`packages/shared/src/schemas.ts` → `UpdateUserSchema`:
Add an optional `role` field:
```ts
role: z.enum([
  'vendor_admin',
  'company_admin',
  'dept_admin',
  'team_leader',
  'member',
  'production_operator',
]).optional(),
```

### Fix — API
`apps/api/src/routes/users.ts` → `PUT /users/:id`:
Already writes `role` if present in `req.body as never`. Confirm the role field is written. Add guard:
- `company_admin` cannot change a user to `vendor_admin`
- `company_admin` cannot promote above their own role level

### Fix — Web
`apps/web/src/app/(app)/users/page.tsx`:
- Add "编辑" button in action column (next to reset password / delete)
- Click → modal form: name, phone, role (dropdown), status (active/locked)
- Authed: `PUT /users/:id`
- Show success toast, refresh list

### Verification
1. Vendor admin opens user list → sees edit button on every user
2. Company admin opens user list → sees edit button only on own company's users
3. Edit member → change to company_admin → save → role updated
4. Try editing vendor_admin as company_admin → 403 forbidden

---

## Task 2 [P0]: Device Receiving — "确认收货" in Detail Page

### Problem
When a device is `shipped` to a customer company, the company_admin can see the device but has no way to confirm receipt. The "确认入库" button only exists in batch select on device list, not in the device detail page.

### Current Flow
```
shipped → (no UI) → delivered → (no UI) → assigned → active
```

### Fix
`apps/web/src/app/(app)/devices/[id]/page.tsx`:
When `d.status === 'shipped'` AND current user is company_admin of ownerCompanyId, show "确认收货" button.
- Button: `<PackageCheck size={14} /> 确认收货`
- Calls: `POST /api/v1/devices/deliver` with `{ deviceIds: [d.id] }`
- On success: refetch device detail → status changes to `delivered`

Also fix device list page (`apps/web/src/app/(app)/devices/page.tsx`):
- `canDeliver` users should see `shipped` status devices in the list
- Line 124: `selectableIds` for `canAssign` should ALSO include `shipped` for company_admin

### Verification
1. Vendor admin ships a device → status = shipped, owner = target company
2. Company admin opens device detail → sees "确认收货" button
3. Click → API call → status becomes `delivered`
4. Company admin opens device list → sees `shipped` devices in list → can batch deliver too

---

## Task 3 [P1]: Device Assigning — "分配授权" in Detail Page

### Problem
After `delivered`, company admin needs to assign device to team/member to trigger `assigned` status. No such button in device detail page.

### Fix
`apps/web/src/app/(app)/devices/[id]/page.tsx`:
When `d.status === 'delivered'` AND current user is company_admin, show "分配授权" button.
- Button: `<UsersRound size={14} /> 分配授权`
- Opens AssignDialog (reuse existing `AssignDialog` component from device list page)
- On assign: refetch → status becomes `assigned`, shows current assignment info

### Verification
1. Device status = delivered → detail page shows "分配授权" button
2. Click → assign to team or user → status = assigned
3. Detail page now shows "当前授权" section with assigned user/team

---

## Task 4 [P1]: RemoteControl Prompt — Fix Model-Specific Message

### Problem
4G lock (82730754, model 4GPAD-SEC-01) shows:  
`"设备需在 assigned/active 状态且为 LoRa 型号才能远程控制"`  
This is wrong — the device is 4G, not LoRa.

### Fix
`apps/web/src/components/RemoteControl.tsx`:
```tsx
const protocolLabel = device.model?.hasLora ? 'LoRa 型号' : 
                      device.model?.has4g ? '4G 联网' : '门锁';

{isControllable
  ? `指令通过 ${protocolLabel === 'LoRa 型号' ? 'LoRa 网关' : '4G 网络'}下发`
  : `设备需在 assigned/active 状态且为${protocolLabel}才能远程控制`}
```

### Verification
1. 4G lock shipped → prompt: "需在 assigned/active 状态且为4G联网才能远程控制"
2. LoRa lock shipped → prompt: "需在 assigned/active 状态且为LoRa型号才能远程控制"

---

## Task 5 [P2]: Company Detail Page — Device Card

### Problem
`/companies/[id]` shows only org structure + personnel list. No device list. Vendor admin viewing a company cannot see what devices that company has.

### Fix
`apps/web/src/app/(app)/companies/[id]/page.tsx`:
Add a third section card at bottom: "设备清单"
- Query: `GET /api/v1/devices?ownerCompanyId={id}` (filtered by company)
- Show table: lock_id, ble_mac, model, status (badge), last_seen_at
- Link each row to `/devices/{id}`
- If user is company_admin → show "确认收货" button on shipped devices

### Verification
1. Vendor admin opens company → sees "设备清单" table
2. Shows all devices owned by that company with status badges
3. Company admin opens own company page → same table visible

---

## Task 6 [P2]: Device List Filter — company_admin Sees shipped

### Fix (partial, overlap with Task 2)
`apps/web/src/app/(app)/devices/page.tsx`:
- `selectableIds` for `canDeliver` role: also include `shipped`
- `selectedDeliverable` filter already uses `shipped` — confirm it works after filter fix

---

## Notes

- Tasks 1-4 are ready to implement immediately. Tasks 5-6 are smaller follow-ons.
- Task 1's schema change requires DB migration? No — just adding `role` to zod schema + API write.
- All API endpoints mentioned already exist; this is purely frontend + schema work.
- The `AssignDialog` component should already exist in the web codebase (used in device list page).
