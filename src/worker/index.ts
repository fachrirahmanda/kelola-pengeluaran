import { Hono } from 'hono';
import type { Env } from './env';
import type { RouteContext } from './context';
import { HttpError } from './http';
import { readSessionToken, verifySession } from './session';
import { authConfig, currentUser, devLogin, googleCallback, logout, startGoogle } from './routes/auth';
import { createSource, deleteSource, listSources, updateSource } from './routes/sources';
import { listBills, payBill } from './routes/bills';
import { exportCsv, monthlyReport } from './routes/reports';
import { askAi } from './routes/ask';
import { getAi, removeAi, saveAi, testAi } from './routes/aiSettings';
import { listBudgets, saveBudget } from './routes/budgets';
import { addLoan, listLoans, payLoan, removeLoan } from './routes/loans';
import { addIncome } from './routes/incomes';
import { getAvatar, getProfile, removeAvatar, saveAvatar, saveName } from './routes/profile';
import { addAttachment, deleteAttachment, driveCallback, getAttachment, getDrive, listAttachments, removeDrive, startDrive } from './routes/drive';
import { acceptInvite, declineInvite, getWorkspace, invite, leaveWorkspace, removeMember, revokeInvite } from './routes/workspace';
import { catchUpRecurring, createRecurring, deleteRecurring, listRecurring, payRecurring, updateRecurring } from './routes/recurring';
import { createCategory, deleteCategory, listCategories, updateCategory } from './routes/categories';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from './routes/transactions';

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
  ['GET', '/ai/settings', true, getAi],
  ['PUT', '/ai/settings', true, saveAi],
  ['DELETE', '/ai/settings', true, removeAi],
  ['POST', '/ai/test', true, testAi],
  ['GET', '/budgets', true, listBudgets],
  ['PUT', '/budgets', true, saveBudget],
  ['GET', '/loans', true, listLoans],
  ['POST', '/loans', true, addLoan],
  ['DELETE', '/loans/:id', true, removeLoan],
  ['POST', '/loans/:id/payments', true, payLoan],
  ['POST', '/sources/:id/income', true, addIncome],
  ['GET', '/profile', true, getProfile],
  ['PUT', '/profile', true, saveName],
  ['PUT', '/profile/avatar', true, saveAvatar],
  ['DELETE', '/profile/avatar', true, removeAvatar],
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

for (const [method, path, auth, handler] of routes) {
  app.on(method, path, async (c) => handler(await contextOf(c, auth)));
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
