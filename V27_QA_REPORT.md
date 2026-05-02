# v2.7 多角色 QA 测试报告

## 测试时间
2026-05-02 16:58 CST

## 测试环境
- 服务器: 120.77.218.138 (Nginx → pm2: web:3000, api:3001)
- 内网API: http://localhost:3001/api/v1
- 内网WEB: http://localhost:3000

## 测试账号

| 角色 | 手机 | 密码 | 状态 |
|------|------|------|:--:|
| vendor_admin (管理员) | 13800000001 | Admin@123 | ✅ |
| member (测试员小王) | 13900000003 | 1k$88E3@nV | ✅ mustChangePassword=true |
| company_admin (鸿哥) | 13900000001 | #9H8Ps@95K | ✅ mustChangePassword=true |

## 测试覆盖

### 测试1: vendor_admin 视角

| # | 测试项 | 预期 | 实际 | 状态 |
|---|--------|------|------|:--:|
| 1.1 | /users/me | 返回 vendor_admin 角色 | role=vendor_admin, mustChangePwd=False | ✅ |
| 1.2 | /authorizations | 看到全量授权 | 16 items | ✅ |
| 1.3 | /devices | 设备列表 | 9 devices | ✅ |
| 1.4 | 页面可访问性 | 厂商功能可见 | 全部页面200 | ✅ |

### 测试2: member (测试员小王) 安全测试

| # | 测试项 | 预期 | 实际 | 状态 |
|---|--------|------|------|:--:|
| 2.1 | /users/me | member角色+companyId | role=member, companyId=5, mustChangePwd=True | ✅ |
| 2.2 | /authorizations | 只看到自己的 | 0 items | ✅ |
| 2.3 | POST /devices/ship | 403 | HTTP 403 | ✅ |
| 2.4 | GET /production/batches | 403 | HTTP 403 | ✅ |
| 2.5 | POST /users | 403 | HTTP 403 | ✅ |
| 2.6 | GET /device-tree | 返回数据 | dict with 5 items | ⚠️ |
| 2.7 | GET /companies | 只看自己公司 | 1 company | ✅ |
| 2.8 | GET /production-batches | 403 | HTTP 404 (路径不存在) | ⚠️ |

### 测试3: company_admin (鸿哥) 视角

| # | 测试项 | 预期 | 实际 | 状态 |
|---|--------|------|------|:--:|
| 3.1 | /users/me | company_admin+companyId | role=company_admin, companyId=5, mustChangePwd=True | ✅ |
| 3.2 | /authorizations | 只看到本公司 | 14 items | ✅ |
| 3.3 | GET /companies | 只看自己公司 | 1 company | ✅ |
| 3.4 | POST /production/batches | 403 | HTTP 403 | ✅ |

### 测试4: 页面 HTTP 状态码

| 页面 | vendor_admin | member | company_admin | 状态 |
|------|:--:|:--:|:--:|:--:|
| / | 200 | 200 | 200 | ✅ |
| /devices | 200 | 200 | 200 | ✅ |
| /companies | 200 | 200 | 200 | ✅ |
| /users | 200 | 200 | 200 | ✅ |
| /authorizations | 200 | 200 | 200 | ✅ |
| /permission-approvals | 200 | 200 | 200 | ✅ |
| /temporary-approvals | 200 | 200 | 200 | ✅ |
| /warehouses | 200 | 200 | 200 | ✅ |
| /lock-numbers | 200 | 200 | 200 | ✅ |
| /repairs | 200 | 200 | 200 | ✅ |
| /audit-logs | 200 | 200 | 200 | ✅ |
| /dashboard | 200 | 200 | 200 | ✅ |
| /settings | 404 | 404 | 404 | 🔴 |
| /devices/manage | 未测 | 未测 | 未测 | ⬜ |

### 测试5: API 安全测试

| # | 测试项 | 预期 | 实际 | 状态 |
|---|--------|------|------|:--:|
| 5.1 | member → POST /devices/ship | 401/403 | 403 | ✅ |
| 5.2 | member → GET /production/batches | 401/403 | 403 | ✅ |
| 5.3 | member → POST /users | 401/403 | 403 | ✅ |
| 5.4 | member → GET /device-tree | 应有权限校验 | 返回了数据(5 items) | 🟡 |
| 5.5 | company_admin → POST /production/batches | 401/403 | 403 | ✅ |

## 发现的问题

### 🔴 P0 阻塞
- **/settings 页面 404**: 所有角色均无法访问设置页面，路由未注册

### 🟡 P1 重要
- **member 能访问 GET /device-tree**: 返回了 5 items 的组织树数据，应该校验 member 是否只能看到自己公司的树，还是暴露了全局结构
- **mustChangePassword=true 但前端未强制改密**: 测试员小王和鸿哥都标记了 mustChangePassword=true，但登录后能正常访问页面（前端可能未实现强制改密流程）

### 🟢 P2 建议
- /production-batches 路径不存在(404) → 实际路径是 /production/batches，建议做别名或统一命名
- 多个新页面(/warehouses, /lock-numbers, /repairs, /permission-approvals, /temporary-approvals)全部返回200，可能只是占位页面，需确认是否有实质内容

## 总结

**核心安全表现良好**: member 角色对生产操作(devices/ship, production/batches, users)的403拦截全部正确。数据隔离(member只看自己公司、company_admin只看自己公司)也正确实现。

**待改进**: 
1. /settings 页面缺失
2. device-tree 接口缺少 member 角色权限校验
3. 前端缺少 mustChangePassword 强制改密流程
4. 大量新页面可能只是骨架，需要填充内容
