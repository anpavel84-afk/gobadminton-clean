// Each generation owns its response, including failures and pagination. Abort is
// an optimization; identity guards remain authoritative when a fetch ignores it.
export type ResourceState<T> = { key: string; status: 'idle' | 'loading' | 'ready' | 'error'; data?: T; error?: unknown };
export class LatestResource<T> {
  private generation = 0;
  private controller?: AbortController;
  private listeners = new Set<() => void>();
  state: ResourceState<T> = { key: '', status: 'idle' };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(state: ResourceState<T>) { this.state = state; this.listeners.forEach(listener => listener()); }
  cancel() { this.generation++; this.controller?.abort(); }
  async load(key: string, task: (signal: AbortSignal) => Promise<T>, append?: (old: T, page: T) => T) {
    const previous = this.state.key === key ? this.state.data : undefined;
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ key, status: 'loading', data: append ? previous : undefined });
    try {
      const page = await task(controller.signal);
      if (generation !== this.generation) return;
      this.publish({ key, status: 'ready', data: append && previous ? append(previous, page) : page });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ key, status: 'error', error, data: append ? previous : undefined });
    }
  }
}
