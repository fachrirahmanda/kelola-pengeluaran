import type { ActivityItem, ActivityKind } from '../../shared/types';
import type { RouteContext } from '../context';
import { json } from '../http';

// The Activity tab in the bell: what the owner and the members did in the data set, newest first (see
// recordActivity in notify.ts). Everyone in the data set sees the same list.

const LATEST = 50;

interface Row {
  id: string;
  kind: ActivityKind;
  data: string;
  created_at: number;
  actor_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  avatar_v: number | null;
}

/** GET /api/activity: the latest actions in the data set in use. */
export async function listActivity({ env, userId, actorId }: RouteContext) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.kind, a.data, a.created_at, a.actor_id, u.name, u.email, u.avatar_url, u.avatar_v
     FROM activity a JOIN users u ON u.id = a.actor_id
     WHERE a.owner_id = ? ORDER BY a.created_at DESC LIMIT ${LATEST}`,
  )
    .bind(userId)
    .all<Row>();
  const items: ActivityItem[] = results.map((row) => ({
    id: row.id,
    kind: row.kind,
    data: JSON.parse(row.data),
    createdAt: row.created_at,
    // Their own upload if they have one, else their Google picture (as in workspace.ts).
    actor: { id: row.actor_id, name: row.name || row.email, avatarUrl: row.avatar_v ? `/api/avatar/${row.actor_id}?v=${row.avatar_v}` : row.avatar_url },
    mine: row.actor_id === actorId,
  }));
  return json({ items });
}
