# v2.7 穿测修复清单 — 给 Claude

> 基于 2026-05-02 全流程仿真测试发现问题

---

## 🔴 P0: POST /authorizations 路由缺失

**现象：** `POST /api/v1/authorizations` 返回 404

**影响：** 批量授权功能完全不可用，阻断客户公司→授权到人的流程

**位置：** `apps/api/src/routes/devices.ts`（GET /authorizations 在第656行，POST revoke 在755行，中间缺创建端点）

**需求：** 在 GET /authorizations 和 POST revoke 之间插入：

```
POST /authorizations
权限: vendor_admin, company_admin, dept_admin
请求体: { deviceIds: number[], userIds: number[], validUntil?: string, validFrom?: string }
逻辑:
  1. scopeToCompany 校验
  2. 遍历 deviceIds × userIds 生成 N×M 条 device_assignment 记录(scope=user)
  3. 如果用户已在某个team中，同时创建 scope=team 的授权
  4. 返回创建的授权列表
返回: { items: [...], createdCount: N }
```

**参考：** 已有 DeviceAssignment 表和 scopeToCompany 工具函数，直接复用。

---

## 🟡 P1: 页面全是 CSR 渲染，SSR 无内容

**现象：** curl 拉取 `/dashboard` `/warehouses` `/authorizations` 等页面只返回空 div，无任何业务内容

**影响：** 搜索引擎不可索引；首屏加载慢；运维监控无法用 curl 健康检查页面内容

**修复：** 
1. 每个页面在服务端渲染至少一个骨架/fallback（加载中状态）
2. 关键页面（dashboard/warehouses/authorizations）做 SSR 预取第一页数据
3. 或者在 `<head>` 中加入页面 title，至少 `curl` 能看到标题

---

## 🟢 P2: 体验优化建议

1. **创建批次缺少 modelId** — 创建批次 API 需要 `modelId` 但数据库中无 Model 记录，建议在 seed 或首次部署时预置型号
2. **mustChangePassword 强制改密流程** — 虽然后端返回 mustChangePassword=true，但初次登录用户缺少引导提示，建议首次登录弹窗提示"请前往设置页修改密码"
3. **开锁指令缺少状态反馈** — 发送开锁指令后返回 `{ commandId, status: "sent" }`，但前端未轮询结果状态，用户不知道是否成功开锁
4. **成员申请权限错误提示不友好** — 字段名错误时只返回 validation error，无指导性提示

---

## 已验证无误（QA 误报，不需修复）

- ✅ company_admin 分配班组正常（assignCount=1）
- ✅ device-commands 开锁指令正常下发（commandId=7, status=sent）
- ✅ repair-intake 维修入库正常（intake #3 创建成功）
- ✅ 安全边界全部正确（member 对生产API全部403）

---

*2026-05-02 18:22 CST | 鸿哥要求尽快修*
