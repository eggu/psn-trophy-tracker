import fs from 'node:fs/promises';
import path from 'node:path';
import { renderDocuments } from '../agent/render.ts';
const output = 'dashboard/dist';
// shortcut: snapshots remain single JSON files; split data if compact snapshots exceed Pages' 25 MiB limit.
async function writeSnapshot(file, snapshot) {
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json) > 25 * 1024 * 1024) throw new Error(`Snapshot exceeds Pages asset limit: ${file}`);
  await fs.writeFile(`${output}/data/${file}`, json);
}
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
for (const file of ['index.html', 'app.js', 'games.js', 'style.css']) await fs.copyFile(`dashboard/${file}`, `${output}/${file}`);
await fs.cp('data', `${output}/data`, { recursive: true });
const entries = [];
for (const file of await fs.readdir('data/history', { recursive: true })) {
  if (!file.endsWith('.json') || file === 'index.json') continue;
  const snapshot = JSON.parse(await fs.readFile(path.join('data/history', file), 'utf8'));
  await writeSnapshot(`history/${file}`, snapshot);
  entries.push({ timestamp: snapshot.metadata.lastSuccessfulSync, path: `/data/history/${file.split(path.sep).join('/')}` });
}
entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
await fs.writeFile(`${output}/data/history/index.json`, JSON.stringify(entries));
const current = JSON.parse(await fs.readFile('data/current.json', 'utf8'));
await writeSnapshot('current.json', current);
const prior = entries.filter(e => e.timestamp < current.metadata.lastSuccessfulSync).at(-1);
const previous = prior ? JSON.parse(await fs.readFile(prior.path.slice(1), 'utf8')) : null;
await fs.mkdir(`${output}/agent/game`, { recursive: true });
for (const [name, markdown] of Object.entries(renderDocuments(current, previous))) await fs.writeFile(`${output}/agent/${name}.md`, markdown);
let attempt = {};
try { attempt = JSON.parse(await fs.readFile('data/sync-status.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(`${output}/agent/metadata.json`, JSON.stringify({ ...attempt, account: current.profile.onlineId, sources: { psn: current.profile.lastSuccessfulSync, ...(current.steam ? { steam: current.steam.lastSuccessfulSync } : {}) }, ...current.metadata, generatedAt: new Date().toISOString() }));
await fs.writeFile(`${output}/_routes.json`, JSON.stringify({ version: 1, include: ['/api/*', '/agent', '/agent/*'], exclude: [] }));
console.log(`Pages assets built with ${entries.length} history entries`);
