# Revisi Akses Departemen HRD — untuk ditinjau, belum deploy

## Cakupan revisi
- `api/sheets.js`: membaca `profiles.department_id`, memvalidasi departemen aktif dari `public.departments`, mengirim scope yang diturunkan server ke Apps Script, dan melakukan filter defensif Program serta Update Mingguan pada respons GET.
- `code.gs`: menerapkan filter GET berdasarkan departemen HRD; memeriksa departemen tujuan saat membuat Program dan kepemilikan `ID_PROGRAM` saat membuat Update Mingguan; membatasi approval ke konteks role yang diperbolehkan.
- `api/users.js`, `app.js`, `index.html`: MASTER dapat memilih/menampilkan departemen akun HRD ketika membuat atau mengedit akun. HRD wajib memiliki departemen. Departemen non-HRD dikosongkan.
- `tests/department-access.test.js`: pemeriksaan statis untuk guard dan wiring utama.

## Asumsi yang perlu diverifikasi sebelum deployment
1. Tabel `public.departments` dan `profiles.department_id` sudah ada pada Supabase target.
2. UUID departemen di UI sama dengan seed yang sudah dikonfirmasi:
   - `a1000000-0000-4000-8000-000000000001` — Departemen Personalia
   - `a1000000-0000-4000-8000-000000000002` — Departemen Rekrutmen dan Seleksi
   - `a1000000-0000-4000-8000-000000000003` — Departemen Kesekretariatan dan Program
   - `a1000000-0000-4000-8000-000000000004` — Departemen Kaderisasi
3. Nilai `MASTER_PROGRAM.DEPARTEMEN` cocok persis (setelah trim) dengan nama departemen canonical pada Supabase.
4. Vercel tetap menyimpan `APPS_SCRIPT_SHARED_SECRET` sebagai environment secret. Jangan menaruh secret di browser atau file source.

## Batas pengujian
- Pemeriksaan sintaks Node.js dan assertion statis lulus.
- Belum diuji terhadap live Supabase, Vercel, Google Sheets, atau deployment Apps Script.
- Tidak ada SQL, data produksi, secret, maupun deployment yang diubah oleh pembuatan ZIP ini.

## Urutan deployment nanti (belum dilakukan)
1. Backup versi Apps Script dan deployment Vercel saat ini.
2. Tinjau dan uji source di environment non-production jika tersedia.
3. Perbarui/deploy versi Apps Script yang memuat `code.gs` ini terlebih dahulu, sambil mempertahankan shared secret di Script Properties.
4. Deploy revisi Vercel setelah Apps Script siap.
5. Uji HRD lintas departemen, pembuatan Program/Update, MASTER lintas departemen, ADMIN, DIREKTUR, VIEWER, dan akses URL/API langsung.
6. Jika ada kegagalan, kembalikan deployment Vercel dan Apps Script ke versi sebelumnya. Tidak ada rollback database yang diperlukan untuk revisi source ini.

**Status: review-only. Jangan deploy tanpa persetujuan terpisah.**
