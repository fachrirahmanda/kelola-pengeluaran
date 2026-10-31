// Types and constants shared by the Worker API and the web app.

export const METHODS = ['cash', 'debit', 'transfer', 'credit'] as const;
export type Method = (typeof METHODS)[number];

export const METHOD_LABELS: Record<Method, string> = {
  cash: 'Tunai',
  debit: 'Debit',
  transfer: 'Transfer',
  credit: 'Kartu kredit',
};

export type TransactionStatus = 'posted' | 'unpaid';

export interface User {
  id: string;
  email: string;
  name: string;
  /** Google profile picture, null when there is none. */
  avatarUrl?: string | null;
  /** The admin manages Google Drive and Ask AI. Everyone else never sees those settings. */
  isAdmin?: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

/** Where money comes from: a savings account, a credit card, or paylater. */
export const SOURCE_KINDS = ['savings', 'credit_card', 'paylater'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  savings: 'Savings',
  credit_card: 'Credit card',
  paylater: 'Paylater',
};

export interface PaymentSource {
  id: string;
  name: string;
  kind: SourceKind;
  /** Only for credit cards and paylater. */
  closingDay: number | null;
  paymentDay: number | null;
  /** Savings: the balance when the source was added. */
  openingBalance?: number;
  /** Credit cards and paylater: the limit, if one is set. */
  creditLimit?: number | null;
  /** Savings: opening balance + income - spent from it. */
  balance?: number;
  /** Credit cards and paylater: what is still unpaid. */
  owed?: number;
  /** The bank or e-wallet (an id from banks.ts), or null for cash and other. */
  bank?: string | null;
  /** The person in the data set this source belongs to (owner or member), or null when it is shared. */
  holderId?: string | null;
}

/** Someone a source of funds can belong to: the owner or a member of the data set. */
export interface SourceHolder {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

/** Credit cards and paylater are billed later, so their transactions stay unpaid until settled. */
export const isBilledKind = (kind: SourceKind) => kind === 'credit_card' || kind === 'paylater';

export interface Transaction {
  id: string;
  occurredOn: string;
  amount: number;
  categoryId: string;
  note: string;
  method: Method;
  sourceId: string | null;
  status: TransactionStatus;
  postedOn: string | null;
  /** Time of day, HH:MM, when it was recorded. Null for older transactions. */
  occurredTime: string | null;
}

export type TransactionInput = Pick<Transaction, 'occurredOn' | 'occurredTime' | 'amount' | 'categoryId' | 'note' | 'method' | 'sourceId'>;

export interface CategoryInput {
  name: string;
  color: string;
  icon: string;
}

export const CATEGORY_COLORS = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#264653', '#457b9d', '#8ab17d', '#9b5de5', '#6c757d'];

export const CATEGORY_ICONS = ['🍜', '🚗', '🛒', '💡', '🎬', '💊', '📚', '💳', '🏠', '🎁', '☕', '📦'];

/** Categories created for every new user. */
export const DEFAULT_CATEGORIES: CategoryInput[] = [
  { name: 'Makan & Minum', color: '#e76f51', icon: '🍜' },
  { name: 'Transportasi', color: '#457b9d', icon: '🚗' },
  { name: 'Belanja Kebutuhan', color: '#2a9d8f', icon: '🛒' },
  { name: 'Tagihan & Utilitas', color: '#e9c46a', icon: '💡' },
  { name: 'Hiburan', color: '#9b5de5', icon: '🎬' },
  { name: 'Kesehatan', color: '#8ab17d', icon: '💊' },
  { name: 'Pendidikan', color: '#264653', icon: '📚' },
  { name: 'Cicilan', color: '#f4a261', icon: '💳' },
  { name: 'Lainnya', color: '#6c757d', icon: '📦' },
];

/** Every API error is returned as `{ "error": "<message in Indonesian>" }`. */
export interface ApiError {
  error: string;
}

/** A bill that is not paid yet: the unpaid transactions of one credit card or paylater source, for one period. */
export interface OpenBill {
  sourceId: string;
  sourceName: string;
  kind: SourceKind;
  /** YYYY-MM, the month the bill closes in. */
  period: string;
  closesOn: string;
  dueOn: string;
  total: number;
  count: number;
}

/** A bill that was paid. */
export interface PaidBill {
  id: string;
  sourceId: string;
  sourceName: string;
  period: string;
  total: number;
  count: number;
  paidOn: string;
  /** The savings account the bill was paid from, if one was chosen. */
  paidFromName: string | null;
}

/** An installment or recurring payment, with where it stands now. */
export interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
  /** YYYY-MM-DD. Installment 1 is due in this month, on this day. */
  startDate: string;
  /** NULL = no end date. */
  totalMonths: number | null;
  paidCount: number;
  /** Installments still to pay, or null when there is no end date. */
  remaining: number | null;
  /** The next installment to pay, or null when all are paid. */
  nextInstallment: number | null;
  nextDueMonth: string | null;
  nextDueDate: string | null;
  /** The next installment is due before this month, and is not paid. */
  overdue: boolean;
  /** The day the latest installment was paid, or null if none is recorded yet. */
  lastPaidOn: string | null;
}

export interface RecurringPayment {
  id: string;
  itemId: string;
  name: string;
  installment: number;
  dueMonth: string;
  amount: number;
  paidOn: string;
  /** The savings account it was paid from by debit, if any. */
  sourceName: string | null;
}

/** Money into a savings account: a one-off income, or one month of a salary. */
export interface Income {
  id: string;
  sourceId: string;
  sourceName: string;
  bank: string | null;
  occurredOn: string;
  amount: number;
  note: string;
  /** Recorded by a salary on its payday; it cannot be removed on its own. */
  fromSalary: boolean;
}

/** Recurring income (gaji) into a savings account, recorded as an income on every pay date. */
export interface Salary {
  id: string;
  sourceId: string;
  sourceName: string;
  name: string;
  amount: number;
  /** Day of the month; a Saturday or Sunday pays on the Friday before. */
  payDay: number;
  /** The first month recorded, YYYY-MM. */
  startMonth: string;
  nextPayDate: string;
}

export const RECURRING_METHODS = ['cash', 'debit', 'transfer'] as const;
export type RecurringMethod = (typeof RECURRING_METHODS)[number];

/** The data set the signed-in person is working in, and who is in it. */
export interface WorkspaceMember {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role: 'owner' | 'member';
  /** When they last had Neraca open, UTC "YYYY-MM-DD HH:MM:SS"; null if not since this was recorded. */
  lastSeenAt?: string | null;
}

/** Seen in the last minute: their open page checks in every 15 seconds. */
export const ACTIVE_WITHIN_MS = 60_000;

/** Whether someone last seen at `lastSeenAt` (UTC, from the server) has Neraca open now. */
export function isActive(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return false;
  return now - new Date(`${lastSeenAt.replace(' ', 'T')}Z`).getTime() < ACTIVE_WITHIN_MS;
}

export interface WorkspaceInvite {
  id: string;
  email: string;
  createdAt: string;
}

export interface Workspace {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  ownerAvatarUrl?: string | null;
  /** The signed-in person's role in this data set. */
  role: 'owner' | 'member';
  /** Everyone in the data set. Only filled in for the owner. */
  members: WorkspaceMember[];
  /** Pending invitations sent by the owner. Only filled in for the owner. */
  invites: WorkspaceInvite[];
}

export interface Invitation {
  id: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
}

export type NotificationKind =
  | 'invite_received'
  | 'invite_accepted'
  | 'invite_declined'
  | 'member_removed'
  | 'member_left'
  | 'data_created'
  | 'data_updated'
  | 'data_deleted'
  | 'bill_due'
  | 'ask_answered'
  | 'ask_failed';

export type ActivityKind =
  | 'tx_created'
  | 'tx_updated'
  | 'tx_deleted'
  | 'bill_paid'
  | 'income_added'
  | 'invite_sent'
  | 'member_joined'
  | 'member_left'
  | 'member_removed';

/** One thing someone did in the data set: the signed-in person (mine) or another member. */
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  data: Record<string, string | number>;
  createdAt: number;
  actor: { id: string; name: string; avatarUrl: string | null };
  mine: boolean;
}

/** One notification for the signed-in person. `data` holds the values its message is built from. */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  data: Record<string, string | number>;
  createdAt: number;
  read: boolean;
}

/** The notifications the app shows: the newest ones, or the ones after a time (for popups), and the unread count. */
export interface NotificationFeed {
  items: AppNotification[];
  unread: number;
  now: number;
}
