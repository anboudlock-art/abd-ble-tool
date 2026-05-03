# v2.7 仿真测试问题清单

> 测试时间: 2026-05-02 14:00-14:18
> 覆盖: 生产→入库→发运→签收→分配→授权→审批→远程命令→维修→撤销 全流程
> 测试数据: 9台设备, 4个批次, 14条授权, 2条临开

---

## 🐛 Bug (需修复)

### #1 /devices/manage 批次下拉无数据 (Bug)
**文件:** `apps/web/src/app/(app)/devices/manage/page.tsx` 第88行
**问题:** API 路径写成了 `/api/v1/production-batches`（404），应该是 `/api/v1/production/batches`
```diff
- apiRequest<BatchListResp>('/api/v1/production-batches', {
+ apiRequest<BatchListResp>('/api/v1/production/batches', {
```
**影响:** 设备管理页批次筛选下拉框永远为空，功能不工作

### #2 device-tree API 不能查 vendor 自己公司
**文件:** `apps/api/src/routes/device-management.ts` 第38-40行
**问题:** vendor_admin 调用时必须传 `?companyId=`，但 vendor 侧边栏默认是 vendor 自己的公司（公司列表里没有vendor自己），vendor 没有"自己公司"的概念，`companyId=null` 直接报错 CONFICT
**影响:** vendor_admin 登录后访问 /devices/manage 会看到错误而非数据

### #3 device-tree API memberCount 依赖 user_membership 表
**问题:** memberCount 从 `user_membership` 表取数据，但创建用户时没有自动插入 `user_membership`，导致 memberCount 永远为 0
**验证:** 只有手动调用 `POST /teams/:id/members` 后才能看到人数
**影响:** 组织树上所有班组都显示 0 人，体验差

### #4 超级管理员看不到自己的公司(三库页面)
**问题:** vendor_admin 通过登录只能看到5家公司选项，但看不到 vendor 自己的"厂商公司"。三库总览 /warehouses 和三库出入都依赖 "厂商公司" 的概念
**影响:** vendor_admin 无法查看自己公司的仓库数据

---

## ⚠️ 体验问题 (Polish)

### #5 device-tree 不返回 leaderName
**API返回:** `{"id":"2","name":"2班","deviceCount":6,"memberCount":1}` — 缺 leaderName
**影响:** OrgTree 没法显示"班长: 张三"这样的标签

### #6 设备列表电量全 null，颜色编码永远不触发
**原因:** test-create 不设置 lastBattery，真实锁上报数据才会触发，仿真环境看不到效果
**建议:** test-create 可以加一个 `battery` 参数，默认随机值

### #7 test-create 跳过 manufactured 状态
**问题:** `activate=false` → `in_warehouse`，`activate=true` → `active`
**缺失状态:**`manufactured` 状态没有入口，状态机跳过了 manufacturing→manufactured→in_warehouse
**影响:** 生产环节看不到"已制造待入库"的设备

---

## ✅ 确认正常

| # | 检查项 | 状态 |
|---|--------|------|
| 1 | 侧边栏 4 组折叠 | ✅ 代码正确 |
| 2 | 设备列表电量颜色编码 | ✅ 代码正确 (需有电池数据) |
| 3 | 设备详情撤销授权 | ✅ 功能正常 |
| 4 | Dashboard recentDevices | ✅ 返回6台|
| 5 | 全流程 (生产→分配→授权→维修) | ✅ 全部走通 |
| 6 | 17 个 PC 页面 | ✅ 全部 200 |
| 7 | 批次筛选 API | ✅ /devices?batchId=N 正常 |
| 8 | 部门过滤 API | ✅ /devices?currentDepartmentId=N 正常 |
| 9 | 锁号导出 | ✅ Excel 200 |
| 10 | 远程命令 | ✅ unlock 正常 |
| 11 | 撤销授权 | ✅ /authorizations/:id/revoke 正常 |
| 12 | 临开审批 | ✅ 正常 |
| 13 | /authorizations API | ✅ 返回14条，正常 |
| 14 | 操作日志 actor 显示 | ✅ 正确显示 actor.name |
