# Neraca

Pencatat pengeluaran pribadi dengan kartu kredit, paylater, tabungan, cicilan, tagihan, laporan, dan data bersama. Satu Worker (`neraca`) melayani aplikasi React dan API `/api/*`, dengan database D1 `neraca`. Stack dan konfigurasinya sama dengan Silpasala (Hono, `@cloudflare/vite-plugin`, Workers Assets). Styling dari Basis design system.

## Setup lokal

```bash
npm install
cp .dev.vars.example .dev.vars   # isi SESSION_SECRET, dan DEV_LOGIN=true untuk login tanpa Google
npm run db:migrate:local
npm run dev                      # app dan API di satu origin, http://localhost:5173
```

`DEV_LOGIN=true` menampilkan form "Dev login" di halaman login, hanya di localhost. Di production variabel ini tidak diset, sehingga endpoint-nya mati.

## Google login

Login memakai token client Google Identity Services. Browser mengirim access token ke Worker, Worker memeriksanya lewat `tokeninfo` dan `userinfo`, lalu membuat session cookie. Tidak perlu client secret dan tidak perlu redirect URI.

Di Google Cloud Console, client OAuth tipe **Web application** harus punya origin JavaScript untuk setiap alamat aplikasi:
- `http://localhost:5173` untuk lokal
- `https://neraca.itscomen.workers.dev` untuk production

`GOOGLE_CLIENT_ID` ada di `wrangler.jsonc` dan `VITE_GOOGLE_CLIENT_ID` di `.env`. Keduanya nilai yang sama.

## Deploy

```bash
npx wrangler login
npm run db:migrate:remote        # hanya saat ada migrasi baru
npm run deploy                   # build lalu wrangler deploy
npx wrangler secret put SESSION_SECRET   # sekali, atau saat ingin mengganti (semua sesi keluar)
npx wrangler secret put SETTINGS_KEY     # sekali; mengenkripsi Drive token dan key NVIDIA, jangan diganti tanpa perlu
```

## Struktur

| Path | Isi |
| --- | --- |
| `src/worker/index.ts` | Router Hono untuk `/api/*`, autentikasi, dan penanganan error |
| `src/worker/routes/` | Handler per fitur: auth, categories, sources, transactions, bills, recurring, reports, workspace |
| `src/worker/google.ts` | Pemeriksaan access token Google |
| `src/worker/session.ts` | Session cookie yang ditandatangani HMAC |
| `src/shared/` | Tipe dan aturan yang dipakai worker dan web (periode tagihan, cicilan) |
| `src/web/` | Aplikasi React: halaman, komponen, dan styles |
| `migrations/` | Skema D1, urut dari `0001` |

## Data bersama

Setiap user punya satu data. Anggota yang diundang bergabung ke data pemilik (lihat Pengaturan → Data dan anggota). Semua tabel data memakai `user_id`, yang untuk anggota berisi id pemilik, jadi semua route bekerja untuk data bersama.
