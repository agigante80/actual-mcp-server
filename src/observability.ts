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
      try {
        // prom.Counter may be a class; construct via known options shape
        const CounterClass = prom.Counter as unknown as new (opts: { name: string; help: string; labelNames?: string[] }) => { inc: (labels?: Record<string, string>, v?: number) => void };
        counter = new CounterClass({ name: 'actual_tool_calls_total', help: 'Total tool calls', labelNames: ['tool'] });
      } catch {
        counter = { inc: (_labels?: Record<string, string>, _v?: number) => {} };
      }
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
