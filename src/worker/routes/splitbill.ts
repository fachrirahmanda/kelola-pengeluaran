import { splitShares, type SplitItem } from '../../shared/splitbill';
import type { Env } from '../env';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { aiConfig, chat } from '../nvidia';
import { debitSourceOf } from './sources';

// Split bill: a bill, the people who share it, its items, and which people each item is shared with. A person can
// be a registered account (the signed-in person, or a member of the data set); those can be recorded as expenses.
// A photo of the invoice is read by a model that can see pictures; the items it finds are only a starting list,
// the person checks and changes them before saving.

/**
 * A model that reads pictures, used for invoices. Ask AI's own model may only read text, so this one is fixed here.
 * It is offered by NVIDIA's hosted models; if NVIDIA stops serving it, change this name.
 */
export const VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';

const NAME_MAX = 60;
const PERSON_MAX = 30;
const MAX_PEOPLE = 20;
const MAX_ITEMS = 100;
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_IMAGE_CHARS = 8_000_000;

/** A date as YYYY-MM-DD. */
const isDateString = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

interface PersonInput {
  name: string;
  userId: string | null;
}

/** The accounts a split bill may point at: the data set's owner, its members, and the signed-in person. */
async function linkableUsersOf(env: Env, userId: string, actorId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare('SELECT user_id FROM workspace_members WHERE owner_id = ?').bind(userId).all<{ user_id: string }>();
  return new Set([userId, actorId, ...results.map((row) => row.user_id)]);
}

/** Checks a bill as sent by the app and returns it in a clean form. Items refer to people by their index. */
function parseBill(body: Record<string, unknown>, linkable: Set<string>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > NAME_MAX) throw new HttpError(400, `Nama tagihan wajib diisi (maks. ${NAME_MAX} karakter)`);
  if (!isDateString(body.date)) throw new HttpError(400, 'Tanggal tidak valid');
  const money = (value: unknown, label: string) => {
    const amount = value ?? 0;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT) throw new HttpError(400, `${label} harus bilangan bulat, 0 atau lebih`);
    return amount;
  };
  const tax = money(body.tax, 'Pajak');
  const service = money(body.service, 'Service');

  if (!Array.isArray(body.people)) throw new HttpError(400, 'Tambahkan orang yang ikut membagi');
  const people = (body.people as unknown[]).map((entry) => {
    const person = typeof entry === 'string' ? { name: entry, userId: null } : (entry as Partial<PersonInput> | null);
    const personName = String(person?.name ?? '').trim();
    const personUser = typeof person?.userId === 'string' ? person.userId : null;
    if (!personName || personName.length > PERSON_MAX) throw new HttpError(400, `Nama orang wajib diisi (maks. ${PERSON_MAX} karakter)`);
    if (personUser && !linkable.has(personUser)) throw new HttpError(400, 'Akun yang dipilih tidak ada di data ini');
    return { name: personName, userId: personUser };
  });
  if (people.length === 0 || people.length > MAX_PEOPLE) throw new HttpError(400, `Orang yang ikut harus 1-${MAX_PEOPLE}`);

  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, 'Tambahkan minimal satu item');
  if (body.items.length > MAX_ITEMS) throw new HttpError(400, `Item maksimal ${MAX_ITEMS}`);
  const items = (body.items as Record<string, unknown>[]).map((item): SplitItem => {
    const itemName = typeof item.name === 'string' ? item.name.trim().slice(0, NAME_MAX) : '';
    const amount = money(item.amount, 'Harga item');
    const assigned = Array.isArray(item.people) ? [...new Set(item.people)] : [];
    if (assigned.some((index) => typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= people.length)) {
      throw new HttpError(400, 'Orang yang dipilih untuk item tidak valid');
    }
    return { name: itemName || 'Item', amount, people: assigned as number[] };
  });
  return { name, date: body.date, tax, service, people, items };
}

/** GET /api/split-bills: the bills, newest first, each with its total. */
export async function listSplitBills({ env, userId }: RouteContext) {
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.name, b.bill_date, b.tax, b.service,
       COALESCE((SELECT SUM(amount) FROM split_items WHERE split_id = b.id), 0) AS subtotal,
       (SELECT COUNT(*) FROM split_people WHERE split_id = b.id) AS people,
       (SELECT COUNT(*) FROM split_records WHERE split_id = b.id) AS recorded
     FROM split_bills b WHERE b.user_id = ? ORDER BY b.bill_date DESC, b.created_at DESC`,
  )
    .bind(userId)
    .all<{ id: string; name: string; bill_date: string; tax: number; service: number; subtotal: number; people: number; recorded: number }>();
  return json({
    bills: results.map((row) => ({
      id: row.id,
      name: row.name,
      date: row.bill_date,
      people: row.people,
      recorded: row.recorded > 0,
      total: row.subtotal + row.tax + row.service,
    })),
  });
}

/** GET /api/split-bills/:id: one bill with its people, its items, and each item's people (by index). */
export async function getSplitBill({ env, userId, params }: RouteContext) {
  const bill = await env.DB.prepare('SELECT id, name, bill_date, tax, service FROM split_bills WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ id: string; name: string; bill_date: string; tax: number; service: number }>();
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');

  const { results: people } = await env.DB.prepare(
    `SELECT p.id, p.name, p.member_user_id, (SELECT COUNT(*) FROM split_records r WHERE r.person_id = p.id) AS recorded
     FROM split_people p WHERE p.split_id = ? ORDER BY p.position`,
  )
    .bind(bill.id)
    .all<{ id: string; name: string; member_user_id: string | null; recorded: number }>();
  const { results: items } = await env.DB.prepare('SELECT id, name, amount FROM split_items WHERE split_id = ? ORDER BY position').bind(bill.id).all<{ id: string; name: string; amount: number }>();
  const { results: links } = await env.DB.prepare(
    'SELECT l.item_id, l.person_id FROM split_item_people l JOIN split_items i ON i.id = l.item_id WHERE i.split_id = ?',
  )
    .bind(bill.id)
    .all<{ item_id: string; person_id: string }>();

  const indexOf = new Map(people.map((person, index) => [person.id, index]));
  return json({
    bill: {
      id: bill.id,
      name: bill.name,
      date: bill.bill_date,
      tax: bill.tax,
      service: bill.service,
      recorded: people.some((person) => person.recorded > 0),
      people: people.map((person) => ({ name: person.name, userId: person.member_user_id, recorded: person.recorded > 0 })),
      items: items.map((item) => ({
        name: item.name,
        amount: item.amount,
        people: links.filter((link) => link.item_id === item.id).map((link) => indexOf.get(link.person_id)).filter((index): index is number => index !== undefined),
      })),
    },
  });
}

/** Writes a bill's people, items and links in one batch. Used by create and by update (which replaces them). */
async function writeBill(env: Env, userId: string, id: string, bill: ReturnType<typeof parseBill>, isNew: boolean) {
  const statements: D1PreparedStatement[] = [];
  if (isNew) {
    statements.push(
      env.DB.prepare('INSERT INTO split_bills (id, user_id, name, bill_date, tax, service) VALUES (?, ?, ?, ?, ?, ?)').bind(id, userId, bill.name, bill.date, bill.tax, bill.service),
    );
  } else {
    statements.push(
      env.DB.prepare("UPDATE split_bills SET name = ?, bill_date = ?, tax = ?, service = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(bill.name, bill.date, bill.tax, bill.service, id, userId),
      env.DB.prepare('DELETE FROM split_items WHERE split_id = ?').bind(id),
      env.DB.prepare('DELETE FROM split_people WHERE split_id = ?').bind(id),
    );
  }
  const personIds = bill.people.map(() => crypto.randomUUID());
  bill.people.forEach((person, index) => {
    statements.push(
      env.DB.prepare('INSERT INTO split_people (id, split_id, name, position, member_user_id) VALUES (?, ?, ?, ?, ?)').bind(personIds[index], id, person.name, index, person.userId),
    );
  });
  bill.items.forEach((item, index) => {
    const itemId = crypto.randomUUID();
    statements.push(env.DB.prepare('INSERT INTO split_items (id, split_id, name, amount, position) VALUES (?, ?, ?, ?, ?)').bind(itemId, id, item.name, item.amount, index));
    for (const person of item.people) {
      statements.push(env.DB.prepare('INSERT INTO split_item_people (item_id, person_id) VALUES (?, ?)').bind(itemId, personIds[person]));
    }
  });
  await env.DB.batch(statements);
}

/** POST /api/split-bills: saves a new bill. */
export async function createSplitBill({ request, env, userId, actorId }: RouteContext) {
  const bill = parseBill(await readJson(request), await linkableUsersOf(env, userId, actorId));
  const id = crypto.randomUUID();
  await writeBill(env, userId, id, bill, true);
  return json({ id }, 201);
}

/** PUT /api/split-bills/:id: replaces a bill's details, people and items. Not after it was recorded as expenses. */
export async function updateSplitBill({ request, env, userId, actorId, params }: RouteContext) {
  const exists = await env.DB.prepare('SELECT 1 FROM split_bills WHERE id = ? AND user_id = ?').bind(params.id, userId).first();
  if (!exists) throw new HttpError(404, 'Tagihan tidak ditemukan');
  const recorded = await env.DB.prepare('SELECT 1 FROM split_records WHERE split_id = ? LIMIT 1').bind(params.id).first();
  if (recorded) throw new HttpError(409, 'Tagihan ini sudah dicatat ke transaksi, jadi tidak bisa diubah.');
  const bill = parseBill(await readJson(request), await linkableUsersOf(env, userId, actorId));
  await writeBill(env, userId, params.id, bill, false);
  return json({ ok: true });
}

/** DELETE /api/split-bills/:id. Transactions already recorded from it stay where they are. */
export async function deleteSplitBill({ env, userId, params }: RouteContext) {
  const result = await env.DB.prepare('DELETE FROM split_bills WHERE id = ? AND user_id = ?').bind(params.id, userId).run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Tagihan tidak ditemukan');
  return json({ ok: true });
}

/**
 * POST /api/split-bills/:id/record { date, categoryId, method: "debit" | "credit", sourceId }: makes one expense for each
 * person who is a registered account and owes something and has not been recorded yet. Debit comes from a savings
 * account; credit from a card or paylater. Each expense is named after the bill and the person.
 */
export async function recordSplitBill({ request, env, userId, params }: RouteContext) {
  const bill = await env.DB.prepare('SELECT id, name, tax, service FROM split_bills WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ id: string; name: string; tax: number; service: number }>();
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');

  const body = await readJson(request);
  if (!isDateString(body.date)) throw new HttpError(400, 'Tanggal tidak valid');
  if (body.method !== 'debit' && body.method !== 'credit') throw new HttpError(400, 'Cara bayar tidak valid');
  if (typeof body.categoryId !== 'string') throw new HttpError(400, 'Pilih kategori');
  const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(body.categoryId, userId).first();
  if (!category) throw new HttpError(400, 'Kategori tidak ditemukan');

  const { results: people } = await env.DB.prepare('SELECT id, name, member_user_id FROM split_people WHERE split_id = ? ORDER BY position')
    .bind(bill.id)
    .all<{ id: string; name: string; member_user_id: string | null }>();
  const { results: items } = await env.DB.prepare('SELECT id, amount FROM split_items WHERE split_id = ? ORDER BY position').bind(bill.id).all<{ id: string; amount: number }>();
  const { results: links } = await env.DB.prepare(
    'SELECT l.item_id, l.person_id FROM split_item_people l JOIN split_items i ON i.id = l.item_id WHERE i.split_id = ?',
  )
    .bind(bill.id)
    .all<{ item_id: string; person_id: string }>();
  const { results: recorded } = await env.DB.prepare('SELECT person_id FROM split_records WHERE split_id = ?').bind(bill.id).all<{ person_id: string }>();

  const indexOf = new Map(people.map((person, index) => [person.id, index]));
  const splitItems: SplitItem[] = items.map((item) => ({
    name: '',
    amount: item.amount,
    people: links.filter((link) => link.item_id === item.id).map((link) => indexOf.get(link.person_id)).filter((index): index is number => index !== undefined),
  }));
  const { shares } = splitShares(people.length, splitItems, bill.tax, bill.service);
  const done = new Set(recorded.map((row) => row.person_id));
  const eligible = people
    .map((person, index) => ({ person, total: shares[index].total }))
    .filter(({ person, total }) => person.member_user_id && total > 0 && !done.has(person.id));
  if (eligible.length === 0) throw new HttpError(400, 'Tidak ada orang yang bisa dicatat. Hanya akun terdaftar yang punya bagian yang belum dicatat.');

  const sum = eligible.reduce((total, row) => total + row.total, 0);
  let sourceId: string | null = null;
  if (body.method === 'debit') {
    sourceId = (await debitSourceOf(env.DB, userId, body.sourceId, sum)).id;
  } else {
    const source = await env.DB.prepare("SELECT id FROM payment_sources WHERE id = ? AND user_id = ? AND kind IN ('credit_card', 'paylater')")
      .bind(body.sourceId ?? '', userId)
      .first<{ id: string }>();
    if (!source) throw new HttpError(400, 'Pilih kartu kredit atau paylater untuk bayar kredit');
    sourceId = source.id;
  }

  const statements: D1PreparedStatement[] = [];
  for (const { person, total } of eligible) {
    const transactionId = crypto.randomUUID();
    const posted = body.method === 'debit';
    statements.push(
      env.DB.prepare(
        `INSERT INTO transactions (id, user_id, occurred_on, amount, category_id, note, method, source_id, status, posted_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(transactionId, userId, body.date, total, body.categoryId, `Split: ${bill.name} (${person.name})`, body.method, sourceId, posted ? 'posted' : 'unpaid', posted ? body.date : null),
      env.DB.prepare('INSERT INTO split_records (split_id, person_id, transaction_id) VALUES (?, ?, ?)').bind(bill.id, person.id, transactionId),
    );
  }
  await env.DB.batch(statements);
  return json({ recorded: eligible.length }, 201);
}

/** Reads the model's answer as JSON, even when it wraps it in text or a code fence. */
function jsonOf(answer: string): Record<string, unknown> | null {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Rupiah from what the model wrote: 25000, "25.000", "Rp 25.000". */
function rupiahOf(value: unknown): number {
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  if (typeof value === 'string') return Number(value.replace(/\D/g, '')) || 0;
  return 0;
}

/**
 * POST /api/split-bills/scan { image }: reads an invoice photo (a data URL) and returns its items, tax and service
 * as a starting list. Nothing is saved; the person checks the list first.
 */
export async function scanInvoice({ request, env }: RouteContext) {
  const config = await aiConfig(env);
  if (!config) throw new HttpError(400, 'Ask AI belum diatur. Admin bisa mengaturnya di Pengaturan.');
  const body = await readJson(request);
  if (typeof body.image !== 'string' || !body.image.startsWith('data:image/') || body.image.length > MAX_IMAGE_CHARS) {
    throw new HttpError(400, 'Foto invoice tidak valid (JPEG atau PNG, maks. 6 MB)');
  }

  const answer = await chat({ ...config, model: VISION_MODEL }, [
    {
      role: 'system',
      content:
        'You read restaurant and shop invoices. Reply with JSON only, no other text: {"items":[{"name":"...","amount":0}],"tax":0,"service":0}. ' +
        'Each amount is the whole price of that line in rupiah as a plain integer (no separators). Tax and service are 0 when the invoice does not show them. ' +
        'Only list lines that are on the invoice; do not add totals as items.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Read this invoice.' },
        { type: 'image_url', image_url: { url: body.image } },
      ],
    },
  ]);

  const parsed = jsonOf(answer);
  const rawItems = Array.isArray(parsed?.items) ? (parsed.items as Record<string, unknown>[]) : [];
  const items = rawItems
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim().slice(0, NAME_MAX) || 'Item' : 'Item',
      amount: rupiahOf(item.amount),
    }))
    .filter((item) => item.amount > 0)
    .slice(0, MAX_ITEMS);
  if (items.length === 0) throw new HttpError(502, 'Foto ini tidak bisa dibaca sebagai invoice. Coba foto yang lebih jelas, atau isi item manual.');
  return json({ items, tax: rupiahOf(parsed?.tax), service: rupiahOf(parsed?.service) });
}

/**
 * DELETE /api/split-bills/:id/record: removes the expenses recorded from a bill, so the bill can be changed again.
 * The records go with their transactions.
 */
export async function unrecordSplitBill({ env, userId, params }: RouteContext) {
  const bill = await env.DB.prepare('SELECT 1 FROM split_bills WHERE id = ? AND user_id = ?').bind(params.id, userId).first();
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');
  const { results } = await env.DB.prepare('SELECT transaction_id FROM split_records WHERE split_id = ?').bind(params.id).all<{ transaction_id: string }>();
  if (results.length === 0) return json({ removed: 0 });
  await env.DB.batch(results.map((row) => env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(row.transaction_id, userId)));
  return json({ removed: results.length });
}
