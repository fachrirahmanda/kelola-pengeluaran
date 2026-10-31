// Writes public/banks/<id>.svg for every bank in src/shared/banks.ts: a round mark in the bank's colour
// with its short name. Not the official logos. Run from the project folder after adding a bank:
//   node scripts/bank-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '.';
const source = readFileSync(join(root, 'src/shared/banks.ts'), 'utf8');
const banks = [...source.matchAll(/\{ id: '([^']+)', name: '([^']+)', short: '([^']+)', color: '([^']+)', textColor: '([^']+)' \}/g)].map(
  ([, id, name, short, color, text]) => ({ id, name, short, color, text }),
);

// The word on each icon: the name people know the brand by, kept short enough to read at 20px.
const LABELS = {
  bca: 'BCA', mandiri: 'MDR', bni: 'BNI', bri: 'BRI', btn: 'BTN', bsi: 'BSI', cimb: 'CIMB', permata: 'PMT',
  danamon: 'DNM', maybank: 'MBK', ocbc: 'OCBC', panin: 'panin', mega: 'mega', jenius: 'JNS', btpn: 'jago', seabank: 'sea',
  blu: 'blu', gopay: 'gopay', ovo: 'OVO', dana: 'DANA', shopeepay: 'SPay', linkaja: 'LA',
};

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function icon({ id, name, color, text }) {
  const label = LABELS[id] ?? name;
  // Bold sans is about 0.7em per character (wide capitals like M); fit the word in 46 of the 64 units, the
  // width of the circle where the text sits.
  const size = Math.min(21, Math.round((46 / (label.length * 0.7)) * 10) / 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${escape(name)}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
      <stop offset="1" stop-color="#000" stop-opacity=".12"/>
    </linearGradient>
    <clipPath id="tile"><circle cx="32" cy="32" r="32"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="64" height="64" fill="${color}"/>
    <rect width="64" height="64" fill="url(#shade)"/>
    <circle cx="58" cy="4" r="24" fill="#fff" fill-opacity=".09"/>
  </g>
  <text x="32" y="${32 + size * 0.36}" text-anchor="middle" font-family="Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="800" font-size="${size}" letter-spacing="-.02em" fill="${text}">${escape(label)}</text>
</svg>
`;
}

const dir = join(root, 'public/banks');
mkdirSync(dir, { recursive: true });
for (const bank of banks) writeFileSync(join(dir, `${bank.id}.svg`), icon(bank));
console.log(`${banks.length} icons written to ${dir}`);
