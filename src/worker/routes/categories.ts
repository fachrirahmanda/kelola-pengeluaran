import { CATEGORY_COLORS, CATEGORY_ICONS, type Category, type CategoryInput } from '../../shared/types';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

const NAME_MAX = 40;

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
}

function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, color: row.color, icon: row.icon };
}

/** Checks the body. Fields that are missing fall back to `current` (used by PATCH). */
function parseCategoryInput(body: Record<string, unknown>, current?: CategoryInput): CategoryInput {
  const name = body.name ?? current?.name;
  const color = body.color ?? current?.color;
  const icon = body.icon ?? current?.icon;

  if (typeof name !== 'string' || !name.trim() || name.trim().length > NAME_MAX) {
    throw new HttpError(400, `Nama kategori wajib diisi (maks. ${NAME_MAX} karakter)`);
  }
  if (typeof color !== 'string' || !CATEGORY_COLORS.includes(color)) throw new HttpError(400, 'Warna tidak valid');
  if (typeof icon !== 'string' || !CATEGORY_ICONS.includes(icon)) throw new HttpError(400, 'Ikon tidak valid');
  return { name: name.trim(), color, icon };
}

/** GET /api/categories */
export async function listCategories({ env, userId }: RouteContext) {
  const { results } = await env.DB.prepare('SELECT id, name, color, icon FROM categories WHERE user_id = ? ORDER BY rowid')
    .bind(userId)
    .all<CategoryRow>();
  return json({ categories: results.map(toCategory) });
}

/** POST /api/categories */
export async function createCategory({ request, env, userId }: RouteContext) {
  const input = parseCategoryInput(await readJson(request));
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare('INSERT INTO categories (id, user_id, name, color, icon) VALUES (?, ?, ?, ?, ?)')
      .bind(id, userId, input.name, input.color, input.icon)
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Nama kategori sudah dipakai');
    throw error;
  }
  return json({ category: { id, ...input } }, 201);
}

/** PATCH /api/categories/:id */
export async function updateCategory({ request, env, userId, params }: RouteContext) {
  const current = await env.DB.prepare('SELECT id, name, color, icon FROM categories WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<CategoryRow>();
  if (!current) throw new HttpError(404, 'Kategori tidak ditemukan');

  const input = parseCategoryInput(await readJson(request), current);
  try {
    await env.DB.prepare('UPDATE categories SET name = ?, color = ?, icon = ? WHERE id = ? AND user_id = ?')
      .bind(input.name, input.color, input.icon, current.id, userId)
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Nama kategori sudah dipakai');
    throw error;
  }
  return json({ category: { id: current.id, ...input } });
}

/** DELETE /api/categories/:id. Refuses while transactions still use the category. */
export async function deleteCategory({ env, userId, params }: RouteContext) {
  const usage = await env.DB.prepare('SELECT COUNT(*) AS total FROM transactions WHERE category_id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ total: number }>();
  if (usage && usage.total > 0) {
    throw new HttpError(409, `Kategori dipakai ${usage.total} transaksi. Pindahkan transaksinya dulu.`);
  }

  const result = await env.DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(params.id, userId).run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Kategori tidak ditemukan');
  return json({ ok: true });
}
