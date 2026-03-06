<div align="center">
# Aplikasi Ujian - Cloudflare Workers + D1

Project ini sudah disiapkan untuk deploy gratis ke Cloudflare:
- Frontend React (Vite) disajikan sebagai static assets
- Backend API `/api/*` berjalan di Cloudflare Worker
- Database memakai Cloudflare D1 (SQLite managed)

## Jalankan Lokal (mode lama Node + SQLite)

1. Install dependency:
   `npm install`
2. Jalankan:
   `npm run dev`

## Deploy Gratis ke Cloudflare

1. Login ke Cloudflare:
   `npx wrangler login`
2. Buat database D1:
   `npx wrangler d1 create quiz_db`
3. Salin `database_id` dari output command ke file `wrangler.jsonc` pada field:
   `d1_databases[0].database_id`
4. Jalankan migrasi schema:
   `npm run cf:d1:migrate`
5. Set password admin (secret):
   `npx wrangler secret put ADMIN_PASSWORD`
6. Build frontend:
   `npm run build:client`
7. Deploy Worker + static assets:
   `npm run cf:deploy`
8. Migrasi data lama dari `quiz.db` lokal ke D1:
   - Cek dulu SQL dump:
     `npm run cf:data:dump`
   - Jalankan migrasi ke D1:
     `npm run cf:data:migrate`

## Development Mode Cloudflare

Jalankan:
`npm run dev:cf`

## Catatan penting

- Endpoint frontend tetap sama (`/api/...`), jadi tidak perlu ubah kode React.
- Data lama di `quiz.db` lokal tidak otomatis pindah ke D1.
- Script migrasi data otomatis tersedia di `scripts/migrate-sqlite-to-d1.mjs`.
- Default seed hanya membuat mata pelajaran awal `Bahasa Indonesia`.
