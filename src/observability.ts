// Lightweight observability wrapper. Uses prom-client when installed; otherwise no-ops.
let registry: any = null;
let counter: any = null;

async function init() {
  if (registry) return { registry, counter };
  try {
    const prom = await import('prom-client');
    registry = prom.register;
    counter = new prom.Counter({ name: 'actual_tool_calls_total', help: 'Total tool calls', labelNames: ['tool'] });
    return { registry, counter };
  } catch (e) {
    // prom-client not installed; provide a noop implementation
    registry = null;
    counter = {
      inc: (_labels: any, _v?: number) => {},
    };
    return { registry, counter };
  }
}

export async function incrementToolCall(toolName: string) {
  const { counter } = await init();
  try { counter.inc({ tool: toolName }, 1); } catch (e) { /* noop */ }
}

export async function getMetricsText(): Promise<string | null> {
  const { registry } = await init();
  if (!registry) return null;
  return await registry.metrics();
}

export default { incrementToolCall, getMetricsText };
