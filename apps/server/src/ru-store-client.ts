/**
 * Client for the Russian store (ru-store on the Russian server, reached through an SSH tunnel).
 * Personal data of users with a Russian number is written there first (2015 ministry
 * clarifications: primary database in Russia); Italy keeps its working copy.
 */
export interface RuUserRecord {
  userId: string; publicKey: string; username: string; displayName: string;
  /** E.164, only for Russian numbers; the Italian database never holds it. */
  phone?: string; phoneHash?: string; emailHash?: string; pushToken?: string;
  lastSeen: number; watching?: string[];
}
export interface RuStore {
  putUser(record: RuUserRecord): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export function createRuStoreClient(baseUrl: string, token: string, fetchImpl: Fetch = fetch as unknown as Fetch, timeoutMs = 8000): RuStore {
  if (!/^http:\/\/[a-z0-9.-]+:\d{2,5}$/i.test(baseUrl)) throw new Error('RU_STORE_URL must be http://host:port (an SSH tunnel)');
  if (Buffer.byteLength(token) < 32) throw new Error('RU_STORE_TOKEN must contain at least 32 bytes');
  async function call(method: string, path: string, body?: unknown) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      if (!response.ok) throw new Error(`ru-store ${method} ${response.status}`);
    } finally { clearTimeout(timer); }
  }
  return {
    putUser: record => call('PUT', `/users/${record.userId}`, record),
    deleteUser: userId => call('DELETE', `/users/${userId}`),
  };
}
