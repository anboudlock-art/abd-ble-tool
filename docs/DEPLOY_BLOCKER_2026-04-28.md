# 🚨 部署阻塞：Web 界面无法从公网访问

**日期:** 2026-04-28  
**服务器:** 121.41.169.217 (阿里云 ECS iZwz9g3hqumxbxh1qgpe9oZ)  
**状态:** 本地一切正常，公网无法访问  

---

## 问题现象

- 访问 `http://121.41.169.217:3000` → **连接超时**
- 访问 `http://121.41.169.217:3001` → **连接超时**
- 服务器本地 `localhost:3000` → ✅ 正常 (HTTP 200)
- 服务器本地 `localhost:3001` → ✅ 正常

## 根因分析

**3000 和 3001 端口未在阿里云安全组中放行。**

- iptables 无规则（不是 OS 防火墙问题）
- 服务器可以 ping 通，SSH 端口正常
- 确认是阿里云安全组层面的端口封锁

## 当前服务状态

| 服务 | 端口 | 本地状态 | 公网访问 |
|------|------|---------|---------|
| abd-web (Next.js) | 3000 | ✅ running | ❌ 超时 |
| abd-api (Fastify) | 3001 | ✅ running | ❌ 超时 |
| PostgreSQL | 5432 | ✅ running | - |
| Redis | 6379 | ✅ running | - |

## 登录信息

| 角色 | 手机号 | 密码 |
|------|--------|------|
| Vendor Admin | 13800000001 | admin123 |
| Vendor Admin | 13800000000 | (待设) |
| Production Operator | 13800000002 | (待设) |
| Company Admin | 13800000003 | (待设) |

## 修复步骤

在阿里云控制台 → ECS → 安全组 → 入方向规则中添加：

| 协议 | 端口 | 来源 | 说明 |
|------|------|------|------|
| TCP | 3000 | 0.0.0.0/0 | Web 前端 |
| TCP | 3001 | 0.0.0.0/0 | API 服务 |

或者通过阿里云 CLI：
```bash
aliyun ecs AuthorizeSecurityGroup --RegionId cn-hangzhou \
  --SecurityGroupId <sg-xxx> \
  --Policy accept --PortRange 3000/3001 --Protocol TCP --SourceCidrIp 0.0.0.0/0
```

## 代码分支

- Web 平台: `claude/smart-lock-web-platform-SUvdF`
- 数据平台: `claude/export-data-platform-e0wSq`

## 待处理

- [ ] 放行 3000/3001 安全组端口
- [ ] 给其他账号设置密码
- [ ] 考虑使用 Nginx 反向代理（只暴露 443/80）
