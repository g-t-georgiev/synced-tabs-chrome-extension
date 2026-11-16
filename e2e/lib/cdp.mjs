/**
 * A minimal Chrome DevTools Protocol client over the browser's WebSocket endpoint, with
 * flattened sessions for pages and workers. No dependencies: Node 22+ has `WebSocket`.
 */
export class Cdp {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    /** @type {Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; method: string }>} */
    this.pending = new Map();
    /** @type {Set<(message: { method: string; params: any; sessionId?: string }) => void>} */
    this.listeners = new Set();

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const call = this.pending.get(message.id);
        if (!call) return;
        this.pending.delete(message.id);
        if (message.error) {
          call.reject(new Error(`${call.method}: ${message.error.message}`));
        } else {
          call.resolve(message.result);
        }
        return;
      }
      this.listeners.forEach((listener) => listener(message));
    });

    socket.addEventListener("close", () => {
      for (const call of this.pending.values()) call.reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }

  /** @param {string} url */
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error(`Cannot connect to ${url}`)), {
        once: true,
      });
    });
    return new Cdp(socket);
  }

  /**
   * Sends a command, to the browser or to a session.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {string} [sessionId]
   */
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /**
   * Listens to protocol events; returns an unsubscribe function.
   * @param {(message: { method: string; params: any; sessionId?: string }) => void} listener
   */
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.socket.close();
  }
}
