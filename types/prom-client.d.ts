declare module 'prom-client' {
  export const register: { metrics: () => Promise<string> };
  export class Counter {
    constructor(opts: { name: string; help: string; labelNames?: string[] });
    inc(labels: Record<string, string>, value?: number): void;
  }
}
