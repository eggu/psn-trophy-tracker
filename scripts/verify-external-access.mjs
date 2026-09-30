import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const base = process.argv[2] ?? 'https://psn-trophy-tracker.pages.dev';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'psn-cors-'));
const results = [];
try {
  for (const [name, endpoint, args, expected] of [
    ['preflight', '/api/v1/games', ['-X', 'OPTIONS', '-H', 'Origin: https://example.com', '-H', 'Access-Control-Request-Method: GET'], 204],
    ['api wildcard preflight', '/api/unknown', ['-X', 'OPTIONS'], 204],
    ['AI Agent', '/api/v1/games', ['-H', 'User-Agent: AIAgentBot/1.0'], 200],
    ['JSON 404', '/api/unknown', [], 404],
    ['read-only POST', '/api/v1/games', ['-X', 'POST'], 405],
    ['Python default UA', '/api/v1/games', ['-H', 'User-Agent: Python-urllib/3.9'], null]
  ]) {
    const { stdout } = await run('curl', ['-sS', '--max-time', '30', '-D', path.join(dir, 'headers'), '-w', '\n%{http_code}', ...args, `${base}${endpoint}`], { maxBuffer: 8 * 1024 * 1024 });
    const status = Number(stdout.slice(stdout.lastIndexOf('\n') + 1));
    const body = stdout.slice(0, stdout.lastIndexOf('\n'));
    const rawHeaders = await fs.readFile(path.join(dir, 'headers'), 'utf8');
    const headers = Object.fromEntries(rawHeaders.split(/\r?\n/).filter(line => line.includes(':')).map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
    if (expected !== null) {
      assert.equal(status, expected, name);
      assert.equal(headers['access-control-allow-origin'], '*', name);
      assert.ok(headers['content-type'].includes('application/json'), name);
      if (status === 204) {
        assert.ok(headers['access-control-allow-methods'].includes('POST'));
        assert.ok(headers['access-control-allow-headers'].includes('X-Requested-With'));
        assert.equal(body, '');
      } else {
        const json = JSON.parse(body);
        if (name === 'AI Agent') {
          assert.ok(json.games.every(g => g.localized?.['en-US'] && g.originalName && g.name === g.localized['en-US'].name));
          assert.ok(json.games.some(g => g.localized?.['ko-KR']));
        }
      }
    }
    results.push({ name, endpoint, status, headers: Object.fromEntries(Object.entries(headers).filter(([key]) => key.startsWith('access-control-') || ['content-type', 'cf-ray', 'cf-mitigated'].includes(key))), ...(expected === null ? { body: body.slice(0, 200) } : {}) });
  }
  const report = { checkedAt: new Date().toISOString(), base, results };
  await fs.writeFile('docs/external-access.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
