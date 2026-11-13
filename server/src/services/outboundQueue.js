/** Bounded FIFO queue. Tasks are async; the ingestion path never awaits them. */
export class BoundedQueue {
  #queue = [];
  #active = 0;
  #stopping = false;
  #idle = null;
  constructor({ concurrency = 4, limit = 1000 } = {}) {
    this.concurrency = concurrency;
    this.limit = limit;
  }
  get pending() { return this.#queue.length; }
  get active() { return this.#active; }
  get size() { return this.pending + this.active; }
  get stopping() { return this.#stopping; }
  enqueue(task) {
    if (this.#stopping) return Promise.reject(new Error('Delivery queue is shutting down.'));
    if (this.size >= this.limit) return Promise.reject(new Error('Delivery queue is full.'));
    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject });
      queueMicrotask(() => this.#drain());
    });
  }
  #drain() {
    while (!this.#stopping && this.#active < this.concurrency && this.#queue.length) {
      const { task, resolve, reject } = this.#queue.shift();
      this.#active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        this.#active -= 1;
        if (this.#stopping && this.size === 0) this.#idle?.();
        else this.#drain();
      });
    }
  }
  /** Reject waiting tasks immediately. Callers track and abort their own in-flight I/O. */
  clear() {
    this.#stopping = true;
    for (const entry of this.#queue.splice(0)) entry.reject(new Error('Delivery cancelled during shutdown.'));
  }
  async onIdle() {
    if (this.size === 0) return;
    await new Promise((resolve) => { this.#idle = resolve; });
  }
  stats() { return { pending: this.pending, active: this.active, concurrency: this.concurrency, limit: this.limit }; }
}

/** Sliding-window limit shared by automatic sends, node tests and manual retries. */
export class GraphRateLimiter {
  #windows = new Map();
  constructor(limit = 30, windowMs = 60_000) { this.limit = limit; this.windowMs = windowMs; }
  take(key, now = Date.now()) {
    const window = (this.#windows.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (window.length >= this.limit) { this.#windows.set(key, window); return false; }
    window.push(now);
    this.#windows.set(key, window);
    // Bound memory even if a caller supplies many distinct graph/test keys.
    if (this.#windows.size > 4096) {
      for (const [id, times] of this.#windows) if (!times.some((time) => now - time < this.windowMs)) this.#windows.delete(id);
      if (this.#windows.size > 4096) this.#windows.delete(this.#windows.keys().next().value);
    }
    return true;
  }
  clear() { this.#windows.clear(); }
}
