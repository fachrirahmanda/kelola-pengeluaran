import { Hono } from 'hono';
import type { Env } from './env';
import type { RouteContext } from './context';
import { HttpError } from './http';
import { readSessionToken, verifySession } from './session';
import { authConfig, currentUser, devLogin, googleCallback, logout, startGoogle } from './routes/auth';
import { createSource, deleteSource, listSources, updateSource } from './routes/sources';
import { listBills, payBill } from './routes/bills';
import { exportCsv, monthlyReport } from './routes/reports';
import { askAi, askHistory, clearAskHistory } from './routes/ask';
import { getAi, removeAi, saveAi, testAi } from './routes/aiSettings';
import { budgetHistory, listBudgets, saveBudget } from './routes/budgets';
import { addLoan, listLoans, payLoan, removeLoan } from './routes/loans';
import { addIncome, deleteIncome, listIncomes } from './routes/incomes';
import { createSalary, deleteSalary, listSalaries, updateSalary } from './routes/salaries';
import { getAvatar, getProfile, removeAvatar, saveAvatar, saveName } from './routes/profile';
import { resetData } from './routes/reset';
import { addAttachment, deleteAttachment, driveCallback, getAttachment, getDrive, listAttachments, removeDrive, startDrive } from './routes/drive';
import { acceptInvite, declineInvite, getWorkspace, invite, leaveWorkspace, removeMember, revokeInvite } from './routes/workspace';
import { catchUpRecurring, createRecurring, deleteRecurring, listRecurring, payRecurring, updateRecurring } from './routes/recurring';
import { createCategory, deleteCategory, listCategories, updateCategory } from './routes/categories';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from './routes/transactions';
import { listNotifications, markNotificationsRead, syncNotifications } from './routes/notifications';
import { listActivity } from './routes/activity';

// API. The React app is served from Workers Assets; only /api/* reaches this Worker.
// Each route keeps its handler; `auth` routes need a session and get the data owner's id.
const app = new Hono<{ Bindings: Env }>().basePath('/api');

type Handler = (ctx: RouteContext) => Promise<Response>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const routes: [Method, string, boolean, Handler][] = [
  ['GET', '/auth/google', false, startGoogle],
  ['GET', '/auth/google/callback', false, googleCallback],
  ['GET', '/auth/me', true, currentUser],
  ['POST', '/auth/logout', false, async () => logout()],
  ['GET', '/auth/config', false, authConfig],
  ['POST', '/auth/dev-login', false, devLogin],

  ['GET', '/categories', true, listCategories],
  ['POST', '/categories', true, createCategory],
  ['PATCH', '/categories/:id', true, updateCategory],
  ['DELETE', '/categories/:id', true, deleteCategory],

  ['GET', '/sources', true, listSources],
  ['POST', '/sources', true, createSource],
  ['PATCH', '/sources/:id', true, updateSource],
  ['DELETE', '/sources/:id', true, deleteSource],

  ['GET', '/recurring', true, listRecurring],
  ['POST', '/recurring', true, createRecurring],
  ['PATCH', '/recurring/:id', true, updateRecurring],
  ['DELETE', '/recurring/:id', true, deleteRecurring],
  ['POST', '/recurring/:id/pay', true, payRecurring],
  ['POST', '/recurring/:id/catch-up', true, catchUpRecurring],

  ['GET', '/workspace', true, getWorkspace],
  ['POST', '/workspace/invites', true, invite],
  ['DELETE', '/workspace/invites/:id', true, revokeInvite],
  ['POST', '/workspace/invites/:id/accept', true, acceptInvite],
  ['POST', '/workspace/invites/:id/decline', true, declineInvite],
  ['DELETE', '/workspace/members/:userId', true, removeMember],
  ['POST', '/workspace/leave', true, leaveWorkspace],

  ['GET', '/reports', true, monthlyReport],
  ['GET', '/reports/export.csv', true, exportCsv],
  ['POST', '/ask', true, askAi],
  ['GET', '/ask/history', true, askHistory],
  ['DELETE', '/ask/history', true, clearAskHistory],
  ['GET', '/ai/settings', true, getAi],
  ['PUT', '/ai/settings', true, saveAi],
  ['DELETE', '/ai/settings', true, removeAi],
  ['POST', '/ai/test', true, testAi],
  ['GET', '/budgets', true, listBudgets],
  ['GET', '/budgets/history', true, budgetHistory],
  ['PUT', '/budgets', true, saveBudget],
  ['GET', '/loans', true, listLoans],
  ['POST', '/loans', true, addLoan],
  ['DELETE', '/loans/:id', true, removeLoan],
  ['POST', '/loans/:id/payments', true, payLoan],
  ['POST', '/sources/:id/income', true, addIncome],
  ['GET', '/incomes', true, listIncomes],
  ['DELETE', '/incomes/:id', true, deleteIncome],
  ['GET', '/salaries', true, listSalaries],
  ['POST', '/salaries', true, createSalary],
  ['PATCH', '/salaries/:id', true, updateSalary],
  ['DELETE', '/salaries/:id', true, deleteSalary],
  ['GET', '/profile', true, getProfile],
  ['PUT', '/profile', true, saveName],
  ['PUT', '/profile/avatar', true, saveAvatar],
  ['DELETE', '/profile/avatar', true, removeAvatar],
  ['POST', '/profile/reset', true, resetData],
  ['GET', '/avatar/:id', true, getAvatar],
  ['GET', '/drive', true, getDrive],
  ['GET', '/drive/connect', true, startDrive],
  ['GET', '/drive/callback', true, driveCallback],
  ['DELETE', '/drive', true, removeDrive],
  ['GET', '/transactions/:id/attachments', true, listAttachments],
  ['POST', '/transactions/:id/attachments', true, addAttachment],
  ['GET', '/attachments/:id', true, getAttachment],
  ['DELETE', '/attachments/:id', true, deleteAttachment],

  ['GET', '/bills', true, listBills],
  ['POST', '/bills/pay', true, payBill],

  ['GET', '/transactions', true, listTransactions],
  ['POST', '/transactions', true, createTransaction],
  ['PUT', '/transactions/:id', true, updateTransaction],
  ['DELETE', '/transactions/:id', true, deleteTransaction],
  ['GET', '/notifications', true, listNotifications],
  ['POST', '/notifications/read', true, markNotificationsRead],
  ['POST', '/notifications/sync', true, syncNotifications],
  ['GET', '/activity', true, listActivity],
];

/** Builds the handler's context. For signed-in routes this checks the session first. */
async function contextOf(c: { req: { raw: Request; param: () => Record<string, string> }; env: Env }, auth: boolean): Promise<RouteContext> {
  const request = c.req.raw;
  const params = c.req.param();
  if (!auth) return { request, env: c.env, userId: '', actorId: '', role: '', params };

  const token = readSessionToken(request);
  const actorId = (token && (await verifySession(c.env, token))) || '';
  if (!actorId) throw new HttpError(401, 'Belum masuk');

  // Members read and change the owner's data. Owners and unlinked accounts use their own.
  const membership = await c.env.DB.prepare('SELECT owner_id, role FROM workspace_members WHERE user_id = ?')
    .bind(actorId)
    .first<{ owner_id: string; role: 'owner' | 'member' }>();
  return {
    request,
    env: c.env,
    userId: membership?.owner_id ?? actorId,
    actorId,
    role: membership?.role ?? 'owner',
    params,
  };
}

/**
 * GET /api/sync: the data set's change counter, which open pages poll to notice changes made elsewhere. The
 * poll also marks the person as active (at most every 30 seconds, to keep writes down).
 */
async function syncVersion({ env, userId, actorId }: RouteContext) {
  const [row] = await Promise.all([
    env.DB.prepare('SELECT version FROM data_versions WHERE user_id = ?').bind(userId).first<{ version: number }>(),
    env.DB.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-30 seconds'))")
      .bind(actorId)
      .run(),
  ]);
  return Response.json({ version: row?.version ?? 0 });
}
routes.push(['GET', '/sync', true, syncVersion]);

/** Writes that are not the shared money data: reading notifications, asking the AI, signing in or out. */
const UNCOUNTED = ['/notifications', '/ask', '/ai/', '/auth/'];

for (const [method, path, auth, handler] of routes) {
  const counted = method !== 'GET' && auth && !UNCOUNTED.some((prefix) => path.startsWith(prefix));
  app.on(method, path, async (c) => {
    const ctx = await contextOf(c, auth);
    const response = await handler(ctx);
    if (!counted || !ctx.userId || !response.ok) return response;
    // A change went through: count it, and tell the page that made it the new count, so that page does not
    // reload for its own change.
    const row = await c.env.DB.prepare(
      'INSERT INTO data_versions (user_id, version) VALUES (?, 1) ON CONFLICT (user_id) DO UPDATE SET version = version + 1 RETURNING version',
    )
      .bind(ctx.userId)
      .first<{ version: number }>();
    const withVersion = new Response(response.body, response);
    withVersion.headers.set('x-data-version', String(row?.version ?? 0));
    return withVersion;
  });
}

app.notFound((c) => c.json({ error: 'Tidak ditemukan' }, 404));
app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400);
  console.error(error);
  return c.json({ error: 'Terjadi kesalahan di server' }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
