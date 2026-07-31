# Prompt untuk Cursor IDE — Aplikasi Checklist Kondisional

## Peran & Tujuan
Kamu adalah AI pair-programmer di Cursor IDE. Bantu saya merancang dan membangun web app checklist mobile-friendly di mana setiap item checklist hanya muncul jika kondisi/rumus yang saya definisikan bernilai true. Item bisa terus ditambah dari waktu ke waktu.

## Tech Stack (target dual-deploy)
- **Frontend**: React + TypeScript + Vite, styling mobile-first (Tailwind).
- **Backend/API**: Cloudflare Workers (Hono atau itty-router).
- **Database**: Cloudflare D1 (SQLite).
- **Deploy target A**: Cloudflare Pages (frontend) + Workers (API) + D1 — deployment utama/production.
- **Deploy target B**: Vercel — untuk deploy UI saja (frontend statis/SSR ringan), API tetap panggil Workers via URL terpisah (CORS diaktifkan). Jangan asumsikan Vercel juga menjalankan D1/Workers.
- Gunakan environment variable untuk base URL API supaya frontend bisa dipindah antar target tanpa ubah kode.

## Model Data
Rancang skema D1 minimal:
- `checklist_items`: id, label, formula (text, DSL kondisi), created_at, order/priority, aktif/nonaktif.
- `checklist_status`: item_id, tanggal_context (jika status per-tanggal), checked (bool), checked_at.
- Jika status dianggap tidak bergantung tanggal (sekali centang = permanen), pakai kolom `checked` langsung di `checklist_items`. **Nyatakan asumsi ini ke saya secara eksplisit sebelum implementasi**, karena ini mempengaruhi cara "sudah centang/belum centang" dievaluasi lintas hari.

## Formula/Condition Engine (DSL)
Bangun evaluator kondisi kustom (bukan `eval()` JS mentah — hindari risiko keamanan) yang mendukung:

**Elemen waktu:**
- tanggal-bulan-tahun, tanggal-bulan, tanggal, bulan-tahun, bulan, tahun
- jam, AM/PM, nama hari

**Elemen status centang:**
- sudah centang / belum centang (untuk item itu sendiri)
- cek centang / cek tidak centang berdasarkan id checklist lain (dependensi antar item)

**Range untuk semua elemen waktu di atas:**
- range tanggal-bulan-tahun, range tanggal-bulan, range tanggal, range bulan-tahun, range bulan, range tahun, range jam, range AM/PM

**Operator logika:**
- `&&`, `||`, `()` untuk grouping, dan bisa dikombinasikan bebas (nested).

**Implementasi yang disarankan:**
1. Tulis grammar formal (BNF ringkas) untuk DSL ini.
2. Buat parser (tokenizer → AST) — gunakan library seperti `chevrotain`, `peggy`, atau parser recursive-descent manual jika scope kecil.
3. Buat evaluator AST yang menerima context: `{ now: Date, checklistStatusMap: Record<id, boolean> }`.
4. Sediakan validasi formula saat item dibuat (parse-time error jika syntax salah), bukan saat runtime evaluasi.
5. Tulis unit test untuk setiap tipe kondisi + kombinasi `&&`/`||`/`()`, termasuk edge case (lintas tahun, lintas bulan, dependensi melingkar antar id checklist — harus dideteksi dan ditolak).

## Low-Code Formula Builder (Drag & Drop)
Selain input formula via teks/DSL mentah, sediakan **visual builder drag & drop** sebagai cara utama pengguna menyusun rumus, dengan mode teks tetap tersedia sebagai fallback/advanced mode (dua arah: builder → teks DSL, dan teks DSL → builder, harus saling sinkron/reversible).

**Kebutuhan komponen builder:**
- Canvas/kanvas drop-zone untuk menyusun blok kondisi secara visual (block-based, ala Blockly/n8n/Node-RED — bukan freeform node-graph, karena struktur logikanya tree/nested, bukan flow).
- Library library yang disarankan: `react-dnd` atau `dnd-kit` untuk drag-and-drop mekanik; render AST sebagai nested block tree.
- **Palette blok** berisi semua elemen kondisi (tanggal-bulan-tahun, tanggal-bulan, tanggal, bulan-tahun, bulan, tahun, jam, AM/PM, nama hari, sudah/belum centang, cek centang/tidak centang by id, dan seluruh varian **range** dari tiap elemen di atas) — drag dari palette ke canvas.
- **Blok operator** `AND` (&&), `OR` (||), dan **Group** (setara `()`) sebagai container yang bisa menampung blok anak (nested, drag blok kondisi/operator lain ke dalamnya) — mendukung nesting sedalam apapun.
- Setiap blok kondisi punya form input kontekstual sesuai tipenya (date picker untuk tanggal, time picker untuk jam, dropdown AM/PM, dropdown nama hari, dropdown pemilihan id checklist lain untuk dependensi, dua input untuk range).
- Reorder blok dalam grup via drag (ubah urutan), pindah blok antar grup via drag, hapus blok, duplikasi blok.
- Validasi real-time di canvas: highlight blok/grup yang error (mis. range terbalik, id checklist yang direferensikan tidak ada/sudah dihapus, grup kosong) — jangan biarkan formula invalid tersimpan.
- **Live preview**: tampilkan hasil evaluasi formula terhadap tanggal/waktu contoh (bisa diubah user) supaya user bisa cek behavior sebelum simpan.
- Toggle "Lihat sebagai teks" untuk menampilkan representasi DSL dari struktur blok saat itu (read-only atau editable dua arah — nyatakan pilihan ini sebagai asumsi jika belum saya tentukan).
- Deteksi dan cegah circular dependency saat user drag blok "cek centang by id" (tidak boleh mereferensikan dirinya sendiri atau membentuk siklus antar item).

**Implikasi arsitektur:**
- AST dari DSL harus didesain sebagai struktur serializable (JSON) yang jadi single source of truth — baik builder maupun parser teks sama-sama menghasilkan/membaca AST ini, sehingga sinkronisasi builder↔teks tidak perlu re-implementasi logika dua kali.
- Simpan formula di D1 sebagai teks DSL (hasil serialize dari AST) supaya evaluator backend tidak perlu tahu soal builder sama sekali.

**Pembagian target device (dua use case terpisah):**
- **Builder drag & drop (mode admin/penyusunan rumus)**: target utama **desktop/laptop (console)**. Cukup mouse-based drag (`react-dnd` dengan HTML5 backend sudah memadai, tidak perlu `dnd-kit`/touch sensor). Di layar kecil boleh dibatasi jadi read-only atau arahkan ke desktop untuk edit rumus.
- **Konsumsi checklist (mode end-user: lihat item yang muncul & centang/uncheck)**: **wajib mobile-friendly dan desktop-friendly sekaligus** — ini interaksi harian utama, jadi harus responsif penuh di kedua form factor.
- Pisahkan route/komponen builder dari route/komponen checklist viewer supaya optimasi masing-masing tidak saling membebani (builder tidak perlu ikut ter-bundle ke halaman checklist mobile).

## Alur Kerja yang Diharapkan dari Cursor
1. **Prasyarat dulu** sebelum coding: konfirmasi skema data, tuliskan grammar DSL, daftar dependency yang dibutuhkan, dan strategi deploy (Pages+Workers+D1 sebagai primary, Vercel sebagai alternate UI-only) — tunjukkan ke saya sebelum generate banyak kode.
2. Untuk keputusan yang reversible dan berisiko rendah (struktur folder, penamaan variabel, pemilihan library parser), **lanjutkan tanpa tanya**, cukup nyatakan asumsi.
3. Untuk hal yang irreversible/berdampak eksternal (menjalankan `wrangler d1 migrations apply` ke DB production, overwrite env var, push ke branch deploy), **minta konfirmasi saya dulu**.
4. Sebelum menyatakan selesai, lakukan self-check:
   - Semua elemen kondisi di atas ter-cover di grammar & evaluator?
   - Test lulus untuk kombinasi `&&`/`||`/`()` dan dependensi antar-id?
   - Build frontend jalan lokal, API Workers jalan lokal (`wrangler dev`), migrasi D1 valid?
   - Instruksi deploy untuk kedua target (Cloudflare & Vercel) sudah ditulis dan teruji minimal secara dry-run?
   - Builder drag & drop (desktop) mendukung semua tipe blok kondisi + range-nya, nesting AND/OR/Group tak terbatas, sinkron dua arah dengan teks DSL, dan validasi real-time?
   - Interaksi checklist (lihat item + centang/uncheck) sudah responsif dan teruji di mobile maupun desktop?

## Format Output yang Diinginkan
- Jawaban ringkas, langsung ke inti, tanpa mengulang instruksi ini.
- Kode dalam blok kode lengkap dan siap jalan (bukan potongan setengah).
- Jika ada asumsi yang diambil, tulis sebagai daftar pendek di awal sebelum kode.