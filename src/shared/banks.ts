// Banks and e-wallets a source can belong to. Each person's data set has its own list (see routes/banks.ts): the
// built-in ones below are its first list, and the person can add, change and remove them. A bank says which kinds
// of source it has (savings, credit card, paylater), so a bank with both (BCA) can hold both. The colour and short
// code stand in for the logo: they are close to each brand's colour, not the official artwork.

import type { SourceKind } from './types';

export interface Bank {
  id: string;
  name: string;
  /** Up to four letters shown on the badge. */
  short: string;
  color: string;
  textColor: string;
  /** The built-in logo's id (public/banks/<logo>.svg), or null: such a bank shows its short code on its colour. */
  logo: string | null;
  savings: boolean;
  creditCard: boolean;
  paylater: boolean;
}

/** The kinds of source a bank can hold. */
export const bankKinds = (bank: Pick<Bank, 'savings' | 'creditCard' | 'paylater'>): SourceKind[] => {
  const kinds: SourceKind[] = [];
  if (bank.savings) kinds.push('savings');
  if (bank.creditCard) kinds.push('credit_card');
  if (bank.paylater) kinds.push('paylater');
  return kinds;
};

/** The text colour that reads on a background colour: white on dark, near-black on light. */
export function textOn(color: string): string {
  const hex = color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? '#1A1A1A' : '#FFFFFF';
}

const SAVINGS_ONLY = { savings: true, creditCard: false, paylater: false };
const WITH_CARD = { savings: true, creditCard: true, paylater: false };

/** The banks a data set starts with. */
export const BUILTIN_BANKS: Bank[] = [
  { id: 'bca', name: 'BCA', short: 'BCA', color: '#0060AF', textColor: '#FFFFFF', logo: 'bca', ...WITH_CARD },
  { id: 'mandiri', name: 'Bank Mandiri', short: 'MDR', color: '#003D79', textColor: '#FFC600', logo: 'mandiri', ...WITH_CARD },
  { id: 'bni', name: 'BNI', short: 'BNI', color: '#F15A22', textColor: '#FFFFFF', logo: 'bni', ...WITH_CARD },
  { id: 'bri', name: 'BRI', short: 'BRI', color: '#00529C', textColor: '#FFFFFF', logo: 'bri', ...WITH_CARD },
  { id: 'btn', name: 'BTN', short: 'BTN', color: '#F7A800', textColor: '#1A1A1A', logo: 'btn', ...WITH_CARD },
  { id: 'bsi', name: 'BSI', short: 'BSI', color: '#00A19A', textColor: '#FFFFFF', logo: 'bsi', ...SAVINGS_ONLY },
  { id: 'cimb', name: 'CIMB Niaga', short: 'CIM', color: '#B1040E', textColor: '#FFFFFF', logo: 'cimb', ...WITH_CARD },
  { id: 'permata', name: 'Permata', short: 'PMT', color: '#00AEEF', textColor: '#FFFFFF', logo: 'permata', ...WITH_CARD },
  { id: 'danamon', name: 'Danamon', short: 'DNM', color: '#F7941D', textColor: '#1A1A1A', logo: 'danamon', ...WITH_CARD },
  { id: 'maybank', name: 'Maybank', short: 'MBK', color: '#FFC72C', textColor: '#1A1A1A', logo: 'maybank', ...WITH_CARD },
  { id: 'ocbc', name: 'OCBC NISP', short: 'OCB', color: '#E31837', textColor: '#FFFFFF', logo: 'ocbc', ...WITH_CARD },
  { id: 'panin', name: 'Panin', short: 'PAN', color: '#0B3C7D', textColor: '#FFFFFF', logo: 'panin', ...SAVINGS_ONLY },
  { id: 'mega', name: 'Bank Mega', short: 'MEG', color: '#1E4D9B', textColor: '#FFFFFF', logo: 'mega', ...WITH_CARD },
  { id: 'jenius', name: 'Jenius', short: 'JNS', color: '#00A6E2', textColor: '#FFFFFF', logo: 'jenius', savings: true, creditCard: true, paylater: true },
  { id: 'btpn', name: 'Jago', short: 'JGO', color: '#FFD500', textColor: '#1A1A1A', logo: 'btpn', ...SAVINGS_ONLY },
  { id: 'seabank', name: 'SeaBank', short: 'SEA', color: '#00B7A5', textColor: '#FFFFFF', logo: 'seabank', savings: true, creditCard: false, paylater: true },
  { id: 'blu', name: 'blu', short: 'blu', color: '#2D9CDB', textColor: '#FFFFFF', logo: 'blu', ...SAVINGS_ONLY },
  { id: 'gopay', name: 'GoPay', short: 'GP', color: '#00AED6', textColor: '#FFFFFF', logo: 'gopay', ...SAVINGS_ONLY },
  { id: 'ovo', name: 'OVO', short: 'OVO', color: '#4C3494', textColor: '#FFFFFF', logo: 'ovo', ...SAVINGS_ONLY },
  { id: 'dana', name: 'DANA', short: 'DANA', color: '#118EEA', textColor: '#FFFFFF', logo: 'dana', ...SAVINGS_ONLY },
  { id: 'shopeepay', name: 'ShopeePay', short: 'SP', color: '#EE4D2D', textColor: '#FFFFFF', logo: 'shopeepay', ...SAVINGS_ONLY },
  { id: 'linkaja', name: 'LinkAja', short: 'LA', color: '#E31E24', textColor: '#FFFFFF', logo: 'linkaja', ...SAVINGS_ONLY },
];
