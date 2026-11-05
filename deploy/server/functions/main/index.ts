/**
 * Edge Runtime 入口分发器（supabase-edge-functions --main-service）
 * Envoy 将 /functions/v1/<name> 重写为 /<name> 后转发到本服务，
 * 这里按首段路径分发到 /home/deno/functions/<name>/index.ts。
 */
const FUNCTION_ROOT = '/home/deno/functions';

Deno.serve(async (req: Request) => {
  const { pathname } = new URL(req.url);
  const parts = pathname.split('/').filter(Boolean);
  // 兼容前缀未被网关剥离的情况（/functions/v1/<name>）
  const serviceName = parts[0] === 'functions' ? parts[2] ?? '' : parts[0] ?? '';

  if (!serviceName) {
    return new Response(JSON.stringify({ error: '缺少函数名' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // @ts-expect-error EdgeRuntime 由 supabase/edge-runtime 注入
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTION_ROOT}/${serviceName}`,
      memoryLimitMb: 150,
      workerTimeoutMs: 5 * 60 * 1000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `函数 ${serviceName} 不存在或启动失败: ${String(e)}` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
