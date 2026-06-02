import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { MC_DIR, META_DB } from '../shared/config';
import type { AgentMeta, AgentBrief, ProjectMetaRow } from '../shared/types';

let db: Database.Database | null = null;

export function initMeta(): void {
  mkdirSync(MC_DIR, { recursive: true });
  db = new Database(META_DB);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_meta (
      id        TEXT PRIMARY KEY,
      pinned    INTEGER NOT NULL DEFAULT 0,
      jobName   TEXT,
      dismissed INTEGER NOT NULL DEFAULT 0,
      notes     TEXT,
      updatedAt INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Migration: add the draggable sort order to existing tables.
  try {
    db.exec('ALTER TABLE agent_meta ADD COLUMN sortOrder REAL');
  } catch {
    // column already exists
  }
  // Migration: add the manual "Blocked" flag.
  try {
    db.exec('ALTER TABLE agent_meta ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
  } catch {
    // column already exists
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_brief (
      id   TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      json TEXT NOT NULL,
      at   INTEGER NOT NULL
    )
  `);
  // Manually-added projects and hidden-project flags. `id` is the realpath of the
  // git-common-dir once known (so it matches discovery), or the entered path until then.
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_meta (
      id        TEXT PRIMARY KEY,
      path      TEXT NOT NULL,
      name      TEXT,
      origin    TEXT NOT NULL DEFAULT 'manual',
      hidden    INTEGER NOT NULL DEFAULT 0,
      addedAt   INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER NOT NULL DEFAULT 0
    )
  `);
}

function rowToProjectMeta(row: any): ProjectMetaRow {
  return {
    id: row.id,
    path: row.path,
    name: row.name ?? null,
    origin: row.origin === 'discovered' ? 'discovered' : 'manual',
    hidden: !!row.hidden,
  };
}

export function getProjectMeta(): ProjectMetaRow[] {
  if (!db) return [];
  return (db.prepare('SELECT * FROM project_meta').all() as any[]).map(rowToProjectMeta);
}

/** Add (or un-hide) a manually-tracked project, keyed by its common-dir id. */
export function addProject(id: string, path: string, name?: string | null): ProjectMetaRow {
  const row: ProjectMetaRow = { id, path, name: name ?? null, origin: 'manual', hidden: false };
  if (!db) return row;
  const now = Date.now();
  db.prepare(
    `INSERT INTO project_meta (id, path, name, origin, hidden, addedAt, updatedAt)
     VALUES (@id, @path, @name, 'manual', 0, @now, @now)
     ON CONFLICT(id) DO UPDATE SET path=@path, name=COALESCE(@name, name), hidden=0, updatedAt=@now`,
  ).run({ id, path, name: row.name, now });
  return row;
}

/** Hide (or show) a project. A discovered project being hidden gets a row of its own. */
export function setProjectHidden(id: string, hidden: boolean, path = '', origin: 'manual' | 'discovered' = 'discovered'): void {
  if (!db) return;
  const now = Date.now();
  db.prepare(
    `INSERT INTO project_meta (id, path, name, origin, hidden, addedAt, updatedAt)
     VALUES (@id, @path, NULL, @origin, @hidden, @now, @now)
     ON CONFLICT(id) DO UPDATE SET hidden=@hidden, updatedAt=@now`,
  ).run({ id, path, origin, hidden: hidden ? 1 : 0, now });
}

/** Persisted brief + the content hash it was computed from (so we don't recompute unchanged ones). */
export function getBrief(id: string): { hash: string; brief: AgentBrief } | null {
  if (!db) return null;
  const row = db.prepare('SELECT hash, json FROM agent_brief WHERE id = ?').get(id) as { hash: string; json: string } | undefined;
  if (!row) return null;
  try {
    return { hash: row.hash, brief: JSON.parse(row.json) as AgentBrief };
  } catch {
    return null;
  }
}

export function setBrief(id: string, hash: string, brief: AgentBrief): void {
  if (!db) return;
  db.prepare(
    `INSERT INTO agent_brief (id, hash, json, at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, json=excluded.json, at=excluded.at`,
  ).run(id, hash, JSON.stringify(brief), brief.at);
}

function rowToMeta(row: any): AgentMeta {
  return {
    id: row.id,
    pinned: !!row.pinned,
    jobName: row.jobName ?? null,
    dismissed: !!row.dismissed,
    blocked: !!row.blocked,
    notes: row.notes ?? null,
    order: row.sortOrder ?? null,
  };
}

const EMPTY = (id: string): AgentMeta => ({ id, pinned: false, jobName: null, dismissed: false, blocked: false, notes: null, order: null });

export function getMeta(id: string): AgentMeta {
  if (!db) return EMPTY(id);
  const row = db.prepare('SELECT * FROM agent_meta WHERE id = ?').get(id);
  return row ? rowToMeta(row) : EMPTY(id);
}

export function getAllMeta(): Map<string, AgentMeta> {
  const out = new Map<string, AgentMeta>();
  if (!db) return out;
  for (const row of db.prepare('SELECT * FROM agent_meta').all() as any[]) out.set(row.id, rowToMeta(row));
  return out;
}

export type MetaPatch = Partial<Pick<AgentMeta, 'pinned' | 'jobName' | 'dismissed' | 'blocked' | 'notes' | 'order'>>;

export function setMeta(id: string, patch: MetaPatch): AgentMeta {
  if (!db) return { ...EMPTY(id), ...patch };
  const cur = getMeta(id);
  const next: AgentMeta = {
    id,
    pinned: patch.pinned ?? cur.pinned,
    jobName: patch.jobName !== undefined ? patch.jobName : cur.jobName,
    dismissed: patch.dismissed ?? cur.dismissed,
    blocked: patch.blocked ?? cur.blocked,
    notes: patch.notes !== undefined ? patch.notes : cur.notes,
    order: patch.order !== undefined ? patch.order : cur.order,
  };
  db.prepare(
    `INSERT INTO agent_meta (id, pinned, jobName, dismissed, blocked, notes, sortOrder, updatedAt)
     VALUES (@id, @pinned, @jobName, @dismissed, @blocked, @notes, @sortOrder, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET pinned=@pinned, jobName=@jobName, dismissed=@dismissed, blocked=@blocked, notes=@notes, sortOrder=@sortOrder, updatedAt=@updatedAt`,
  ).run({ id, pinned: next.pinned ? 1 : 0, jobName: next.jobName, dismissed: next.dismissed ? 1 : 0, blocked: next.blocked ? 1 : 0, notes: next.notes, sortOrder: next.order, updatedAt: Date.now() });
  return next;
}
