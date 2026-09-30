import { handleApiRequest, errorResponse } from './router.js';
import { selectHistoryEntry, type HistoryEntry } from './history.js';
import type { CanonicalSnapshot } from '../../schemas/index.js';

export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  DATA_STORE?: { get(key: string): Promise<string | null> };
  DATA_JSON?: string;
  DATA_BASE_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS?.fetch(request) ?? new Response('Not found', { status: 404 });
    const respond = (res: ReturnType<typeof errorResponse>) => new Response(request.method === 'HEAD' || res.status === 204 ? null : res.body, { status: res.status, headers: res.headers });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return respond(errorResponse('METHOD_NOT_ALLOWED', 'Read-only API', 405));
    if (request.method === 'OPTIONS') return respond(await handleApiRequest({ snapshot: null, requestUrl: request.url, method: 'OPTIONS' }));
    const read = async <T>(path: string): Promise<T> => {
      if (env.DATA_STORE) {
        const raw = await env.DATA_STORE.get(path.replace(/^\/data\//, ''));
        if (!raw) throw new Error('Missing data');
        return JSON.parse(raw);
      }
      const assetRequest = new Request(new URL(path, env.DATA_BASE_URL ?? request.url));
      const response = env.ASSETS ? await env.ASSETS.fetch(assetRequest) : await fetch(assetRequest);
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) throw new Error('Missing JSON asset');
      return await response.json() as T;
    };
    try {
      const snapshot = env.DATA_JSON ? JSON.parse(env.DATA_JSON) as CanonicalSnapshot : await read<CanonicalSnapshot>('/data/current.json');
      const historySnapshots: CanonicalSnapshot[] = [];
      if (url.pathname.replace(/\/+$/, '') === '/api/v1/changes') {
        const since = url.searchParams.get('since');
        if (since !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(since) || !Number.isFinite(Date.parse(since)))) return respond(errorResponse('INVALID_SINCE', 'Use an ISO8601 timestamp', 400));
        const entries = await read<HistoryEntry[]>('/data/history/index.json');
        const entry = selectHistoryEntry(entries, snapshot.metadata.lastSuccessfulSync, since);
        if (entry) historySnapshots.push(await read<CanonicalSnapshot>(entry.path));
      }
      return respond(await handleApiRequest({ snapshot, historySnapshots, requestUrl: request.url, method: request.method }));
    } catch {
      return respond(errorResponse('DATA_UNAVAILABLE', 'Canonical data could not be loaded', 503));
    }
  }
};
