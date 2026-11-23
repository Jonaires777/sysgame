// Cliente mínimo da API Client-Server do Matrix (fetch puro, sem React).

export interface Session {
  user_id: string;
  access_token: string;
}

export class MatrixError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown>) {
    super(message);
  }
  get errcode(): string | undefined {
    return this.data.errcode as string | undefined;
  }
}

export interface MatrixEvent {
  type: string;
  sender: string;
  content: Record<string, any>;
  state_key?: string;
  event_id?: string;
  origin_server_ts?: number;
}

export interface SyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, { state?: { events?: MatrixEvent[] }; timeline?: { events?: MatrixEvent[] } }>;
    invite?: Record<string, { invite_state?: { events?: MatrixEvent[] } }>;
    leave?: Record<string, unknown>;
  };
}

const enc = encodeURIComponent;
const DEVICE_NAME = "Última Carta (web)";

export class MatrixClient {
  private txn = 0;

  constructor(public homeserver: string, public session: Session | null = null) {}

  async api<T = any>(method: string, path: string, body?: unknown, opts: { auth?: boolean; query?: Record<string, string | number | null | undefined>; signal?: AbortSignal } = {}): Promise<T> {
    const url = new URL(`${this.homeserver}/_matrix/client/v3${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.auth !== false && this.session) headers.Authorization = `Bearer ${this.session.access_token}`;
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: opts.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new MatrixError((data as any).error || `HTTP ${r.status}`, r.status, data as Record<string, unknown>);
    return data as T;
  }

  login(user: string, password: string): Promise<Session> {
    return this.api("POST", "/login", {
      type: "m.login.password",
      identifier: { type: "m.id.user", user },
      password,
      initial_device_display_name: DEVICE_NAME,
    }, { auth: false });
  }

  async register(username: string, password: string): Promise<Session> {
    const body = { username, password, initial_device_display_name: DEVICE_NAME };
    try {
      return await this.api("POST", "/register", body, { auth: false });
    } catch (e) {
      // autenticação interativa: o servidor devolve 401 com uma sessão; completamos com m.login.dummy
      if (!(e instanceof MatrixError) || e.status !== 401 || !e.data.session) throw e;
      return this.api("POST", "/register", { ...body, auth: { type: "m.login.dummy", session: e.data.session } }, { auth: false });
    }
  }

  send(roomId: string, type: string, content: unknown): Promise<{ event_id: string }> {
    return this.api("PUT", `/rooms/${enc(roomId)}/send/${enc(type)}/${Date.now()}-${this.txn++}`, content);
  }

  join(roomIdOrAlias: string): Promise<{ room_id: string }> {
    return this.api("POST", `/join/${enc(roomIdOrAlias)}`, {});
  }

  sync(since: string | null, filter: string, signal?: AbortSignal): Promise<SyncResponse> {
    return this.api("GET", "/sync", null, { query: { since, timeout: since ? 30000 : 0, filter }, signal });
  }
}
