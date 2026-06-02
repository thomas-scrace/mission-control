import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, HOME, SSE_COALESCE_MS } from '../shared/config';
import type { ServerEvent, Project, Tool } from '../shared/types';
import { store, type StoreChange } from '../collector/store';
import { initMeta, setMeta, addProject, setProjectHidden } from '../collector/meta';
import { startCollector } from '../collector/index';
import { focusAgent } from '../collector/focus';
import { launchAgent } from '../collector/launch';
import { projectStore, refreshProjects, setActiveProject, type ProjectStoreChange } from '../collector/projects';
import { commonDir, showToplevel } from '../collector/git';
import { considerNotify, primeStatus } from './notify';

/**
 * A ServerEvent without its `serverTime` — the `send` helper stamps that on.
 * Distributes over the union (a plain `Omit` would collapse the variants and
 * drop their per-type fields).
 */
type EventPayload = ServerEvent extends infer E
  ? E extends ServerEvent
    ? Omit<E, 'serverTime'>
    : never
  : never;

/** Reject cross-site POSTs: a local page is fine, a foreign Origin is not. */
function sameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches / non-browser clients omit Origin
  try {
    const u = new URL(origin);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../dist/web');

async function main(): Promise<void> {
  initMeta();
  await startCollector();

  // Prime statuses so we don't notify for everything that's already waiting/erroring on boot.
  for (const a of store.all()) primeStatus(a);
  // Global notify listener (independent of whether a browser is connected).
  store.on('change', (c: StoreChange) => {
    if (c.type === 'upsert') considerNotify(c.agent);
  });

  const app = Fastify({ logger: false });

  app.get('/api/snapshot', async () => ({ agents: store.all(), projects: projectStore.all(), serverTime: Date.now() }));

  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Stamp every event with a fresh server clock at write time.
    const send = (ev: EventPayload) =>
      reply.raw.write(`data: ${JSON.stringify({ ...ev, serverTime: Date.now() })}\n\n`);
    send({ type: 'snapshot', agents: store.all(), projects: projectStore.all() });

    const onChange = (c: StoreChange) => {
      if (c.type === 'upsert') send({ type: 'upsert', agent: c.agent });
      else send({ type: 'remove', id: c.id });
    };
    store.on('change', onChange);

    // Coalesce project upserts — a sweep can touch many slots at once; one push per
    // project per SSE_COALESCE_MS keeps the wire (and the UI) calm.
    const pendingProjects = new Map<string, Project>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      for (const p of pendingProjects.values()) send({ type: 'project-upsert', project: p });
      pendingProjects.clear();
    };
    const onProjectChange = (c: ProjectStoreChange) => {
      if (c.type === 'upsert') {
        pendingProjects.set(c.project.id, c.project);
        if (!flushTimer) flushTimer = setTimeout(flush, SSE_COALESCE_MS);
      } else {
        pendingProjects.delete(c.id);
        send({ type: 'project-remove', id: c.id });
      }
    };
    projectStore.on('change', onProjectChange);

    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      store.off('change', onChange);
      projectStore.off('change', onProjectChange);
      if (flushTimer) clearTimeout(flushTimer);
    });
    reply.hijack();
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/agents/:id/meta', async (req, reply) => {
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden origin' });
    const { id } = req.params;
    const b = req.body ?? {};
    const m = setMeta(id, {
      pinned: b.pinned as boolean | undefined,
      jobName: b.jobName as string | null | undefined,
      dismissed: b.dismissed as boolean | undefined,
      blocked: b.blocked as boolean | undefined,
      notes: b.notes as string | null | undefined,
      order: b.order as number | undefined,
    });
    const agent = store.get(id);
    if (!agent) return reply.code(404).send({ error: 'agent not found' });
    const updated = { ...agent, pinned: m.pinned, jobName: m.jobName, dismissed: m.dismissed, blocked: m.blocked, notes: m.notes, order: m.order ?? agent.order };
    store.upsert(updated);
    return updated;
  });

  // Bring the agent's own window to the front (iTerm tab for Claude, thread for Codex).
  app.post<{ Params: { id: string } }>('/api/agents/:id/focus', async (req, reply) => {
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden origin' });
    const agent = store.get(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'agent not found' });
    return focusAgent(agent);
  });

  // Start a new agent in an empty worktree slot. Claude = real launch (new iTerm tab);
  // Codex = raise the app + copy the path (no launch-with-cwd API). Path is allowlisted
  // to enumerated worktrees under HOME inside launchAgent.
  app.post<{ Body: { worktreePath?: string; tool?: string } }>('/api/launch', async (req, reply) => {
    if (!sameOrigin(req)) return reply.code(403).send({ ok: false, detail: 'forbidden origin' });
    const { worktreePath, tool } = req.body ?? {};
    if (typeof worktreePath !== 'string' || (tool !== 'claude' && tool !== 'codex')) {
      return reply.code(400).send({ ok: false, detail: 'worktreePath and tool (claude|codex) required' });
    }
    return launchAgent(worktreePath, tool as Tool);
  });

  // Manually add a project tab by repo path (so empty repos can appear too).
  app.post<{ Body: { path?: string; name?: string } }>('/api/projects', async (req, reply) => {
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden origin' });
    const raw = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    if (!raw) return reply.code(400).send({ error: 'path required' });
    let p = raw;
    if (p === '~') p = HOME;
    else if (p.startsWith('~/')) p = path.join(HOME, p.slice(2));
    let real: string;
    try {
      real = await realpath(p);
    } catch {
      return reply.code(400).send({ error: 'path not found' });
    }
    const home = HOME.endsWith('/') ? HOME : HOME + '/';
    if (!(real === HOME || real.startsWith(home))) return reply.code(400).send({ error: 'path must be under your home directory' });
    const top = await showToplevel(real);
    const cd = top ? await commonDir(top) : null;
    if (!top || !cd) return reply.code(400).send({ error: 'not a git repository' });
    addProject(cd, top, req.body?.name ?? null);
    await refreshProjects();
    return projectStore.get(cd) ?? { ok: true };
  });

  // Hide a project tab (discovered or manual).
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden origin' });
    setProjectHidden(req.params.id, true);
    await refreshProjects();
    return { ok: true };
  });

  // Client hint: which project tab is in view (bounds empty-slot PR polling).
  app.post<{ Body: { id?: string | null } }>('/api/active-project', async (req, reply) => {
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'forbidden origin' });
    setActiveProject(req.body?.id ?? null);
    return { ok: true };
  });

  // Serve the built UI in production. In dev, Vite serves it and proxies /api here.
  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: PORT, host: '127.0.0.1' });
  const where = existsSync(WEB_DIST) ? `http://127.0.0.1:${PORT}` : `dev API on :${PORT} (run \`npm run dev:web\` for the UI)`;
  // eslint-disable-next-line no-console
  console.log(`[missioncontrol] ${where}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[missioncontrol] fatal:', e);
  process.exit(1);
});
