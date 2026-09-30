import { renderManifest, renderStatus, type AgentMetadata } from '../../agent/render.js';
import { corsHeaders } from './router.js';
import type { Env } from './index.js';

export async function handleAgent(request: Request, env: Env): Promise<Response> {
  const headers = { ...corsHeaders, 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=60' };
  const respond = (body: string, status = 200) => new Response(request.method === 'HEAD' || status === 204 ? null : body, { status, headers });
  if (request.method === 'OPTIONS') return respond('', 204);
  if (!['GET', 'HEAD'].includes(request.method)) return respond('# Method not allowed\n\nRead-only Agent View.\n', 405);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (!/^\/agent(?:\/(?:status|profile|changes|recent|games|game\/NPWR\d+_\d+))?$/.test(path)) return respond('# Not found\n\nRead [Agent View](/agent) for available documents.\n', 404);
  const dynamic = path === '/agent' || path === '/agent/status';
  const asset = dynamic ? '/agent/metadata.json' : `${path}.md`;
  try {
    if (!env.ASSETS) {
      if (!env.DATA_BASE_URL || new URL(env.DATA_BASE_URL).origin === new URL(request.url).origin) throw new Error('Missing upstream');
      const upstream = await fetch(new Request(new URL(path, env.DATA_BASE_URL)));
      if (!(upstream.headers.get('content-type') || '').includes('text/markdown')) throw new Error('Invalid Markdown upstream');
      return respond(await upstream.text(), upstream.status);
    }
    const assetRequest = new Request(new URL(asset, request.url));
    const response = await env.ASSETS.fetch(assetRequest);
    const type = response.headers.get('content-type') || '';
    if (!response.ok || (dynamic ? !type.includes('json') : type.includes('text/html'))) return respond('# Document unavailable\n', path.startsWith('/agent/game/') ? 404 : 503);
    if (dynamic) {
      const meta = await response.json() as AgentMetadata;
      if (!meta.account || !Number.isFinite(Date.parse(meta.lastSuccessfulSync))) throw new Error('Invalid metadata');
      return respond(path === '/agent' ? renderManifest(meta) : renderStatus(meta));
    }
    return respond(await response.text());
  } catch { return respond('# Data unavailable\n\nTry again after the next deployment.\n', 503); }
}
