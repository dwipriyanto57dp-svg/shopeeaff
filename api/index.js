import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { nanoid } from 'nanoid';
import { v2 as cloudinary } from 'cloudinary';
import { Redis } from '@upstash/redis';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

// Fallback untuk test lokal saja. Di Vercel wajib pakai Upstash Redis agar data tidak hilang.
const memoryDb = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('File harus gambar: jpg, png, webp, atau gif'));
    cb(null, true);
  },
});

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isValidShopeeUrl(url) {
  try {
    const u = new URL(url);
    return ['shopee.co.id', 'www.shopee.co.id', 's.shopee.co.id'].includes(u.hostname);
  } catch {
    return false;
  }
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function layout(content) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Generator Link Affiliate</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;color:#111827}.wrap{max-width:880px;margin:32px auto;padding:0 16px}.card{background:#fff;border-radius:18px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.08);margin-bottom:18px}label{font-weight:700;display:block;margin-top:14px}input,textarea{width:100%;box-sizing:border-box;margin-top:6px;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px}button,.btn{display:inline-block;background:#ee4d2d;color:white;border:0;border-radius:10px;padding:12px 16px;font-weight:700;margin-top:16px;cursor:pointer;text-decoration:none}.muted{color:#6b7280}.success{background:#ecfdf5;border:1px solid #a7f3d0;padding:12px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.thumb{width:100%;height:150px;object-fit:cover;border-radius:12px;border:1px solid #e5e7eb}.danger{background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:12px;color:#991b1b}.note{background:#fff7ed;border:1px solid #fed7aa;padding:12px;border-radius:12px;color:#9a3412}</style>
</head>
<body><div class="wrap">${content}</div></body>
</html>`;
}

async function saveLink(id, item) {
  if (redis) {
    await redis.set(`link:${id}`, item);
    await redis.lpush('links:history', id);
    await redis.ltrim('links:history', 0, 49);
    return;
  }
  memoryDb.set(id, item);
}

async function getLink(id) {
  if (redis) return await redis.get(`link:${id}`);
  return memoryDb.get(id);
}

async function getHistory() {
  if (redis) {
    const ids = await redis.lrange('links:history', 0, 11);
    const rows = [];
    for (const id of ids) {
      const item = await getLink(id);
      if (item) rows.push([id, item]);
    }
    return rows;
  }
  return Array.from(memoryDb.entries()).reverse().slice(0, 12);
}

function uploadToCloudinary(fileBuffer) {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return reject(new Error('Cloudinary belum disetting di Environment Variables'));
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'shopeeaff',
        resource_type: 'image',
        transformation: [{ width: 1200, height: 630, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

app.get('/', async (req, res) => {
  const resultId = req.query.id;
  const resultUrl = resultId ? `${baseUrl(req)}/r/${resultId}` : '';
  const historyRows = await getHistory();
  const history = historyRows.map(([id, item]) => `
    <div class="card">
      ${item.img ? `<img class="thumb" src="${escapeHtml(item.img)}" alt="${escapeHtml(item.title)}">` : ''}
      <h3>${escapeHtml(item.title)}</h3>
      <p class="muted">${escapeHtml(item.desc)}</p>
      <p><a href="/r/${id}" target="_blank">/r/${id}</a></p>
    </div>
  `).join('');

  res.send(layout(`
    <div class="card">
      <h1>Generator Link Affiliate</h1>
      <p class="muted">Buat halaman preview Facebook/WhatsApp lalu redirect ke link Shopee.</p>
      ${!redis ? `<div class="note"><b>Mode lokal:</b> UPSTASH_REDIS belum disetting. Di Vercel, data bisa hilang kalau tidak pakai Redis.</div>` : ''}
      ${resultUrl ? `<div class="success"><b>Sukses!</b><br><input value="${escapeHtml(resultUrl)}" readonly onclick="this.select()"></div>` : ''}
      <form method="post" action="/generate" enctype="multipart/form-data">
        <label>Link Shopee</label>
        <input name="shopeeLink" placeholder="https://shopee.co.id/..." required>
        <label>Judul</label>
        <input name="title" placeholder="Judul postingan" required maxlength="120">
        <label>Deskripsi</label>
        <textarea name="desc" rows="4" placeholder="Deskripsi singkat" maxlength="500"></textarea>
        <label>Gambar Preview</label>
        <input type="file" name="image" accept="image/*" required>
        <button type="submit">Generate Link</button>
      </form>
    </div>
    <h2>Riwayat</h2>
    <div class="grid">${history || '<p class="muted">Belum ada riwayat.</p>'}</div>
  `));
});

app.post('/generate', upload.single('image'), async (req, res, next) => {
  try {
    const { shopeeLink, title, desc = '' } = req.body;

    if (!isValidShopeeUrl(shopeeLink)) {
      return res.status(400).send(layout(`<div class="danger">Link harus domain Shopee resmi.</div><a class="btn" href="/">Kembali</a>`));
    }

    if (!req.file) {
      return res.status(400).send(layout(`<div class="danger">Gambar wajib diupload agar preview Facebook/WhatsApp muncul.</div><a class="btn" href="/">Kembali</a>`));
    }

    const imageUrl = await uploadToCloudinary(req.file.buffer);
    const id = nanoid(10);

    await saveLink(id, {
      shopeeLink,
      title,
      desc,
      img: imageUrl,
      createdAt: new Date().toISOString(),
    });

    res.redirect(`/?id=${id}`);
  } catch (err) {
    next(err);
  }
});

app.get('/r/:id', async (req, res) => {
  const item = await getLink(req.params.id);
  if (!item) return res.status(404).send(layout('<div class="card"><h1>Link tidak ditemukan</h1><a class="btn" href="/">Kembali</a></div>'));

  const pageUrl = `${baseUrl(req)}${req.originalUrl}`;
  const safeTitle = escapeHtml(item.title);
  const safeDesc = escapeHtml(item.desc || 'Cek promo dan produk pilihan hari ini.');
  const safeImg = escapeHtml(item.img);
  const safeShopee = escapeHtml(item.shopeeLink);

  res.send(`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2;url=${safeShopee}" />

  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />

  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="${safeImg}" />
  <meta property="og:image:secure_url" content="${safeImg}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:type" content="website" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${safeImg}" />

  <style>body{font-family:Arial,sans-serif;background:#fff7f4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{max-width:520px;background:white;padding:28px;border-radius:20px;box-shadow:0 12px 35px rgba(0,0,0,.1);text-align:center}img{max-width:100%;border-radius:14px}.btn{display:inline-block;background:#ee4d2d;color:#fff;padding:12px 16px;border-radius:10px;text-decoration:none;font-weight:700}</style>
</head>
<body>
  <div class="box">
    <p>Menuju halaman produk...</p>
    ${safeImg ? `<img src="${safeImg}" alt="${safeTitle}">` : ''}
    <h1>${safeTitle}</h1>
    <p>${safeDesc}</p>
    <a class="btn" href="${safeShopee}">Buka Sekarang</a>
  </div>
</body>
</html>`);
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).send(layout(`<div class="danger">Ukuran file terlalu besar. Maksimal 10MB.</div><a class="btn" href="/">Kembali</a>`));
  }
  res.status(500).send(layout(`<div class="danger">Terjadi error: ${escapeHtml(err.message || 'Internal Server Error')}</div><a class="btn" href="/">Kembali</a>`));
});

// Untuk Vercel: export app, jangan app.listen di serverless.
export default app;

// Untuk run lokal: npm run dev
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ShopeeAF jalan di http://localhost:${PORT}`);
  });
}
