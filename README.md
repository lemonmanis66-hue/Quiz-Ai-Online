# Quiz AI Online — Production Ready

Aplikasi web HTTPS-ready untuk mengubah materi belajar menjadi kuis pilihan ganda berbasis AI.

## Fitur

- Input teks langsung
- Upload TXT, PDF, DOCX
- AI membuat 5–30 soal
- Tingkat kesulitan Easy / Medium / Hard / Mixed
- Soal konsep, hubungan, aplikasi, dan analisis
- Validasi format JSON dari AI
- Skor dan akurasi
- Review jawaban + pembahasan
- Diagnosis topik yang lemah
- Rekomendasi belajar
- Adaptive Learning: latihan ulang berdasarkan kesalahan
- Riwayat quiz tersimpan lokal di browser
- UI responsif HP/laptop
- Security headers dengan Helmet
- Rate limiting untuk endpoint AI
- API key hanya di server
- Siap deploy ke Render dengan HTTPS

## Jalankan lokal

1. Install Node.js 20+
2. Salin `.env.example` menjadi `.env`
3. Isi `OPENAI_API_KEY`
4. Jalankan:

```bash
npm install
npm start
```

Buka `http://localhost:3000`.

## Deploy HTTPS dengan Render

1. Upload project ini ke GitHub.
2. Di Render pilih **New → Web Service**.
3. Hubungkan repository GitHub.
4. Render dapat memakai `render.yaml`, atau isi:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Di Environment Variables tambahkan:
   - `OPENAI_API_KEY` = API key kamu
   - `AI_MODEL` = `gpt-4o-mini`
6. Deploy.

Render menyediakan URL HTTPS untuk web service setelah deploy. Jangan memasukkan API key ke file frontend.

## Custom domain HTTPS

Di pengaturan service Render, tambahkan custom domain milikmu. Ikuti instruksi DNS yang diberikan Render. Sertifikat HTTPS dikelola oleh platform.

## Catatan keamanan

- Jangan commit `.env`.
- Jangan menaruh `OPENAI_API_KEY` di `public/`.
- Rate limiting sudah diterapkan pada endpoint AI.
- Batas upload default 10 MB.
- Materi dibatasi agar request AI tidak terlalu besar.
- Aplikasi ini tidak menyimpan materi di server secara permanen.

## Produksi lebih lanjut

Untuk penggunaan banyak pengguna, tambahkan database + autentikasi + server-side progress. Riwayat pada versi ini masih disimpan di browser pengguna.
