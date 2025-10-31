// Lightweight observability wrapper. Uses prom-client when installed; otherwise no-ops.
// Lightweight observability wrapper. Uses prom-client when installed; otherwise no-ops.

type RegistryLike = {
  metrics: () => Promise<string> | string;
};

let registry: RegistryLike | null = null;

type CounterLike = {
  inc: (labels?: Record<string, string>, value?: number) => void;
};

let counter: CounterLike | null = null;

async function init() {
  if (registry) return { registry, counter };
  try {
    // Dynamically import prom-client. When present we adapt to its runtime API.
    const prom = await import('prom-client');
    // prom.register implements metrics()
    registry = prom.register as RegistryLike;
    // Create a Counter if available (some versions export Counter class)
    if (typeof prom.Counter === 'function') {
      // runtime: instantiate Counter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      counter = new (prom.Counter as any)({ name: 'actual_tool_calls_total', help: 'Total tool calls', labelNames: ['tool'] }) as CounterLike;
    } else {
      // fallback: try to use prom.register.getSingleMetric or similar; if not present, noop
      counter = {
        inc: (_labels?: Record<string, string>, _v?: number) => {},
      };
    }
    return { registry, counter };
  } catch (e) {
    // prom-client not installed; provide a noop implementation
    registry = null;
    counter = {
      inc: (_labels?: Record<string, string>, _v?: number) => {},
    };
    return { registry, counter };
  }
}

export async function incrementToolCall(toolName: string) {
  const { counter } = await init();
  try { counter?.inc({ tool: toolName }, 1); } catch (e) { /* noop */ }
}

export async function getMetricsText(): Promise<string | null> {
  const { registry } = await init();
  if (!registry) return null;
  // registry.metrics may be sync or async depending on prom-client version
  const m = registry.metrics();
  if (typeof m === 'string') return m;
  return await m;
}

export default { incrementToolCall, getMetricsText };
