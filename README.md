# ShopeeAFF Vercel Fixed

Versi ini sudah cocok untuk Vercel:

- Upload gambar ke Cloudinary, bukan folder lokal.
- Simpan data link ke Upstash Redis, bukan `data/links.json`.
- Sudah ada Open Graph meta tag untuk preview Facebook/WhatsApp.

## Environment Variables di Vercel

Tambahkan di Vercel → Project → Settings → Environment Variables:

```txt
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

## Run lokal

```bash
npm install
npm run dev
```

## Deploy

```bash
git add .
git commit -m "fix vercel cloudinary redis"
git push
```

Lalu deploy otomatis di Vercel.
