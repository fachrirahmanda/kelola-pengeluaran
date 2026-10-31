import { BUILTIN_BANKS, textOn, type Bank } from '../../shared/banks';
import type { Env } from '../env';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

// The banks of a data set. The first time one is needed, it gets the built-in list. Only the owner changes them.

const NAME_MAX = 40;
const SHORT_MAX = 4;

interface BankRow {
  id: string;
  name: string;
  short: string;
  color: string;
  text_color: string;
  logo: string | null;
  savings: number;
  credit_card: number;
  paylater: number;
}

const toBank = (row: BankRow): Bank => ({
  id: row.id,
  name: row.name,
  short: row.short,
  color: row.color,
  textColor: row.text_color,
  logo: row.logo,
  savings: row.savings === 1,
  creditCard: row.credit_card === 1,
  paylater: row.paylater === 1,
});

/** The data set's banks. Writes the built-in list first if the data set has none yet. */
export async function banksOf(env: Env, userId: string): Promise<Bank[]> {
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM banks WHERE user_id = ?').bind(userId).first<{ total: number }>();
  if (!count || count.total === 0) {
    await env.DB.batch(
      BUILTIN_BANKS.map((bank) =>
        env.DB.prepare(
          'INSERT OR IGNORE INTO banks (user_id, id, name, short, color, text_color, logo, savings, credit_card, paylater) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(userId, bank.id, bank.name, bank.short, bank.color, bank.textColor, bank.logo, +bank.savings, +bank.creditCard, +bank.paylater),
      ),
    );
  }
  const { results } = await env.DB.prepare('SELECT * FROM banks WHERE user_id = ? ORDER BY rowid').bind(userId).all<BankRow>();
  return results.map(toBank);
}

/** GET /api/banks */
export async function listBanks({ env, userId }: RouteContext) {
  return json({ banks: await banksOf(env, userId) });
}

/** Checks a bank: its name, its short code, its colour, and at least one kind of source. */
function parseBank(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > NAME_MAX) throw new HttpError(400, `Nama bank wajib diisi (maks. ${NAME_MAX} karakter)`);
  const short = typeof body.short === 'string' ? body.short.trim() : '';
  if (!short || short.length > SHORT_MAX) throw new HttpError(400, `Singkatan wajib diisi (maks. ${SHORT_MAX} huruf)`);
  const color = typeof body.color === 'string' ? body.color : '';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, 'Warna tidak valid');
  const savings = body.savings === true;
  const creditCard = body.creditCard === true;
  const paylater = body.paylater === true;
  if (!savings && !creditCard && !paylater) throw new HttpError(400, 'Pilih minimal satu jenis: tabungan, kartu kredit, atau paylater');
  return { name, short: short.toUpperCase(), color: color.toUpperCase(), textColor: textOn(color), savings, creditCard, paylater };
}

/** POST /api/banks */
export async function createBank({ request, env, userId, role }: RouteContext) {
  if (role !== 'owner') throw new HttpError(403, 'Hanya pemilik data yang bisa mengubah bank');
  const input = parseBank(await readJson(request));
  await banksOf(env, userId);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO banks (user_id, id, name, short, color, text_color, logo, savings, credit_card, paylater) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
  )
    .bind(userId, id, input.name, input.short, input.color, input.textColor, +input.savings, +input.creditCard, +input.paylater)
    .run();
  return json({ bank: toBank({ id, name: input.name, short: input.short, color: input.color, text_color: input.textColor, logo: null, savings: +input.savings, credit_card: +input.creditCard, paylater: +input.paylater }) }, 201);
}

/** PATCH /api/banks/:id: the kinds it holds can change; a source that already has a kind it no longer allows keeps it. */
export async function updateBank({ request, env, userId, role, params }: RouteContext) {
  if (role !== 'owner') throw new HttpError(403, 'Hanya pemilik data yang bisa mengubah bank');
  const input = parseBank(await readJson(request));
  const result = await env.DB.prepare(
    'UPDATE banks SET name = ?, short = ?, color = ?, text_color = ?, savings = ?, credit_card = ?, paylater = ? WHERE user_id = ? AND id = ?',
  )
    .bind(input.name, input.short, input.color, input.textColor, +input.savings, +input.creditCard, +input.paylater, userId, params.id)
    .run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Bank tidak ditemukan');
  const row = await env.DB.prepare('SELECT * FROM banks WHERE user_id = ? AND id = ?').bind(userId, params.id).first<BankRow>();
  return json({ bank: toBank(row!) });
}

/** DELETE /api/banks/:id: refused while a source still uses the bank. */
export async function deleteBank({ env, userId, role, params }: RouteContext) {
  if (role !== 'owner') throw new HttpError(403, 'Hanya pemilik data yang bisa mengubah bank');
  const used = await env.DB.prepare('SELECT COUNT(*) AS total FROM payment_sources WHERE user_id = ? AND bank = ?').bind(userId, params.id).first<{ total: number }>();
  if (used && used.total > 0) throw new HttpError(409, `Bank ini dipakai ${used.total} sumber dana. Pindahkan dulu sumber dananya.`);
  const result = await env.DB.prepare('DELETE FROM banks WHERE user_id = ? AND id = ?').bind(userId, params.id).run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Bank tidak ditemukan');
  return json({ ok: true });
}

