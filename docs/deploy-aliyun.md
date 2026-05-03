# 阿里云 ECS 部署（dev / staging）

针对当前项目的"单台 ECS + Nginx + 直接 node 跑"的最小化部署方式。生产规模上来后再切 ACK + SLB。

---

## 1. 服务清单

| 服务 | 端口 | 进程 |
|---|---|---|
| Nginx | 80（443 后续） | 系统 |
| `@abd/api` | 3001 | `pm2` |
| `@abd/web` (standalone) | 3000 | `pm2` |
| `@abd/gw-server` | 8901 | `pm2` |
| `@abd/worker` | — | `pm2` |
| Postgres | 5432 | `apt`/Docker |
| Redis | 6379 | `apt`/Docker |

---

## 2. 阿里云安全组

要在 **ECS 实例本身绑定的那个安全组**（在 ECS 控制台 → 实例 → 安全组 标签页查实际绑的 sg-xxx，不要在别的安全组上加规则）开：

- `80/tcp` 0.0.0.0/0（HTTP）
- `443/tcp` 0.0.0.0/0（HTTPS，备案后）
- `8901/tcp` 0.0.0.0/0（网关 TCP；如果网关有公网固定 IP 可以收紧）
- `22/tcp` 仅运维 IP

**别开放** 3000 / 3001 / 5432 / 6379 给公网。它们都靠 Nginx 反代和本机访问。

---

## 3. Nginx 配置（关键）

`/etc/nginx/sites-available/abd`（软链到 `sites-enabled/`）:

```nginx
server {
    listen 80;
    server_name 120.77.218.138;  # 备案后改域名

    # ---- Next.js 静态资源 ----
    # 必须用 alias 直连源构建产物。Next.js standalone server 自身
    # 不 serve /_next/static/*，靠 nginx 直发更快。
    location /_next/static/ {
        alias /root/abd-ble-tool/apps/web/.next/static/;
        expires 365d;
        access_log off;
    }

    # public/ 下的 favicon、图片等
    location ~* ^/(favicon\.ico|robots\.txt|.+\.(png|jpg|jpeg|svg|webp|ico)$) {
        root /root/abd-ble-tool/apps/web/public;
        expires 30d;
        access_log off;
    }

    # ---- API 反代 ----
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /openapi/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 健康检查直通
    location = /healthz   { proxy_pass http://127.0.0.1:3001/healthz; access_log off; }
    location = /readyz    { proxy_pass http://127.0.0.1:3001/readyz; access_log off; }

    # ---- 其它一切给 Next.js ----
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket（后期 /api 实时通道留口）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    client_max_body_size 16m;
}
```

应用：

```bash
sudo ln -sf /etc/nginx/sites-available/abd /etc/nginx/sites-enabled/abd
sudo nginx -t && sudo systemctl reload nginx
```

> ⚠️ **不要把 `NEXT_PUBLIC_API_BASE_URL` 设成 `http://120.77.218.138:3001`**——浏览器从 80 端口跨到 3001 会被安全组挡，CORS 也通不过。要么走相对路径，要么留空走默认。
> 把 `apps/web` 的 `NEXT_PUBLIC_API_BASE_URL` 设为空字符串或 `http://120.77.218.138`（不带端口），所有 `/api/v1/*` 自动走同源 + nginx 反代，最干净。

---

## 4. 构建 + 启动

```bash
cd /root/abd-ble-tool
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm build               # 会顺带跑 postbuild 拷贝 standalone 静态文件

# 用 pm2 启所有服务
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # 让 pm2 在重启后自动起来（按提示执行 sudo 命令）
```

`ecosystem.config.cjs`（放仓库根，建议加进版本控制）：

```js
module.exports = {
  apps: [
    {
      name: 'abd-api',
      cwd: '/root/abd-ble-tool',
      script: 'apps/api/dist/index.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'abd-gw-server',
      cwd: '/root/abd-ble-tool',
      script: 'apps/gw-server/dist/index.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'abd-worker',
      cwd: '/root/abd-ble-tool',
      script: 'apps/worker/dist/index.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'abd-web',
      cwd: '/root/abd-ble-tool',
      // standalone 模式：不需要 pnpm/next 在路径上
      script: 'apps/web/.next/standalone/apps/web/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '127.0.0.1',
      },
    },
  ],
};
```

环境变量从仓库根的 `.env` 读（pm2 默认 inherits 进程环境，所以先 `set -a; source .env; set +a` 再 `pm2 restart all --update-env`）。

---

## 5. 首次激活厂商管理员

```bash
# 仅本机访问（VENDOR_BOOTSTRAP_TOKEN 别开放给外网）
curl -X POST http://127.0.0.1:3001/api/v1/auth/set-password \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"13800000000\",\"password\":\"<强密码>\",\"setupToken\":\"$VENDOR_BOOTSTRAP_TOKEN\"}"
```

完成后建议立即在 `.env` 里**清空 `VENDOR_BOOTSTRAP_TOKEN`** 或把它改成只有运维才知道的随机串。

---

## 6. 常见坑

| 现象 | 根因 | 解 |
|---|---|---|
| 静态文件 404 | `output: 'standalone'` 不 serve `/_next/static/` | 用 nginx `alias` 直发（§3） |
| 浏览器 CORS 报错 | `NEXT_PUBLIC_API_BASE_URL` 跨端口 | 走 nginx 反代同源 |
| 加规则后还是连不上 | 加在了不绑定的安全组 | ECS → 实例 → 安全组 看实际绑的 sg-xxx |
| 80 端口报 502 | Next.js 没起 / 端口冲突 | `pm2 logs abd-web`，确认 PORT=3000 没被占 |
| 502 后日志写"upstream prematurely closed" | Node 进程崩了 | `pm2 logs` 找堆栈 |
| `prisma migrate deploy` 卡住 | RDS 安全组没放 ECS 内网 IP | RDS 控制台 → 数据安全 → 白名单 |
