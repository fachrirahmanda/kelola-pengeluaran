import type { Env } from './env';

export interface RouteContext {
  request: Request;
  env: Env;
  /** Owner of the data being read or changed. For a member, this is the owner, not the member. */
  userId: string;
  /** The signed-in person. Empty for public routes. */
  actorId: string;
  /** The signed-in person's role in the data: 'owner' or 'member'. Empty for public routes. */
  role: 'owner' | 'member' | '';
  /** Named groups from the route pattern, e.g. `id`. */
  params: Record<string, string>;
}
