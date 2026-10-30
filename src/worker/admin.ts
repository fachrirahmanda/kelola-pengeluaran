import type { Env } from './env';
import { getUser } from './users';

/** Whether this person is the admin: the account ADMIN_EMAIL names. The admin manages the app's Google Drive and Ask AI. */
export async function isAdmin(env: Env, actorId: string) {
  if (!env.ADMIN_EMAIL) return false;
  const user = await getUser(env.DB, actorId);
  return !!user && user.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
}
