// Banks and e-wallets a source can belong to. The colour and short code stand in for the logo: they are
// close to each brand's colour, not the official artwork.

export interface Bank {
  id: string;
  name: string;
  /** Two or three letters shown on the badge. */
  short: string;
  color: string;
  textColor: string;
}

export const BANKS: Bank[] = [
  { id: 'bca', name: 'BCA', short: 'BCA', color: '#0060AF', textColor: '#FFFFFF' },
  { id: 'mandiri', name: 'Bank Mandiri', short: 'MDR', color: '#003D79', textColor: '#FFC600' },
  { id: 'bni', name: 'BNI', short: 'BNI', color: '#F15A22', textColor: '#FFFFFF' },
  { id: 'bri', name: 'BRI', short: 'BRI', color: '#00529C', textColor: '#FFFFFF' },
  { id: 'btn', name: 'BTN', short: 'BTN', color: '#F7A800', textColor: '#1A1A1A' },
  { id: 'bsi', name: 'BSI', short: 'BSI', color: '#00A19A', textColor: '#FFFFFF' },
  { id: 'cimb', name: 'CIMB Niaga', short: 'CIM', color: '#B1040E', textColor: '#FFFFFF' },
  { id: 'permata', name: 'Permata', short: 'PMT', color: '#00AEEF', textColor: '#FFFFFF' },
  { id: 'danamon', name: 'Danamon', short: 'DNM', color: '#F7941D', textColor: '#1A1A1A' },
  { id: 'maybank', name: 'Maybank', short: 'MBK', color: '#FFC72C', textColor: '#1A1A1A' },
  { id: 'ocbc', name: 'OCBC NISP', short: 'OCB', color: '#E31837', textColor: '#FFFFFF' },
  { id: 'panin', name: 'Panin', short: 'PAN', color: '#0B3C7D', textColor: '#FFFFFF' },
  { id: 'mega', name: 'Bank Mega', short: 'MEG', color: '#1E4D9B', textColor: '#FFFFFF' },
  { id: 'btpn', name: 'Jago', short: 'JGO', color: '#FFD500', textColor: '#1A1A1A' },
  { id: 'seabank', name: 'SeaBank', short: 'SEA', color: '#00B7A5', textColor: '#FFFFFF' },
  { id: 'blu', name: 'blu', short: 'blu', color: '#2D9CDB', textColor: '#FFFFFF' },
  { id: 'gopay', name: 'GoPay', short: 'GP', color: '#00AED6', textColor: '#FFFFFF' },
  { id: 'ovo', name: 'OVO', short: 'OVO', color: '#4C3494', textColor: '#FFFFFF' },
  { id: 'dana', name: 'DANA', short: 'DANA', color: '#118EEA', textColor: '#FFFFFF' },
  { id: 'shopeepay', name: 'ShopeePay', short: 'SP', color: '#EE4D2D', textColor: '#FFFFFF' },
  { id: 'linkaja', name: 'LinkAja', short: 'LA', color: '#E31E24', textColor: '#FFFFFF' },
];

export const bankById = (id: string | null | undefined) => (id ? BANKS.find((bank) => bank.id === id) : undefined);
