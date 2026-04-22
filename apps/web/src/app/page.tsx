export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-12">
      <h1 className="text-4xl font-bold tracking-tight">Anboud 智能锁管理平台</h1>
      <p className="text-lg text-slate-600">LoRa-BLE Smart Lock Platform · v0.1 scaffold</p>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="设备管理" desc="生产仓库 · 公司设备区 · 现场部署" />
        <Card title="组织架构" desc="公司 · 部门 · 班组 · 人员" />
        <Card title="远程控制" desc="远程开锁 · 状态查询 · 实时事件" />
        <Card title="对接 API" desc="AppKey · Webhook · OpenAPI" />
      </div>
      <footer className="mt-12 text-sm text-slate-400">
        后端 API:{' '}
        <code className="rounded bg-slate-200 px-1">
          {process.env.NEXT_PUBLIC_API_BASE_URL ?? 'not configured'}
        </code>
      </footer>
    </main>
  );
}

function Card({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{desc}</p>
    </div>
  );
}
