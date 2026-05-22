import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'links.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('File harus gambar: jpg, png, webp, atau gif'));
    cb(null, true);
  },
});

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

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

function layout(content) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Generator Link Affiliate</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;color:#111827}.wrap{max-width:880px;margin:32px auto;padding:0 16px}.card{background:#fff;border-radius:18px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.08);margin-bottom:18px}label{font-weight:700;display:block;margin-top:14px}input,textarea{width:100%;box-sizing:border-box;margin-top:6px;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:15px}button,.btn{display:inline-block;background:#ee4d2d;color:white;border:0;border-radius:10px;padding:12px 16px;font-weight:700;margin-top:16px;cursor:pointer;text-decoration:none}.muted{color:#6b7280}.success{background:#ecfdf5;border:1px solid #a7f3d0;padding:12px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.thumb{width:100%;height:150px;object-fit:cover;border-radius:12px;border:1px solid #e5e7eb}.danger{background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:12px;color:#991b1b}</style>
</head>
<body><div class="wrap">${content}</div></body>
</html>`;
}

app.get('/', (req, res) => {
  const db = readDb();
  const resultId = req.query.id;
  const resultUrl = resultId ? `${req.protocol}://${req.get('host')}/r/${resultId}` : '';
  const history = Object.entries(db).reverse().map(([id, item]) => `
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
      <p class="muted">Buat halaman preview lalu redirect ke link Shopee.</p>
      ${resultUrl ? `<div class="success"><b>Sukses!</b><br><input value="${escapeHtml(resultUrl)}" readonly onclick="this.select()"></div>` : ''}
      <form method="post" action="/generate" enctype="multipart/form-data">
        <label>Link Shopee</label>
        <input name="shopeeLink" placeholder="https://shopee.co.id/..." required>
        <label>Judul</label>
        <input name="title" placeholder="Judul postingan" required maxlength="120">
        <label>Deskripsi</label>
        <textarea name="desc" rows="4" placeholder="Deskripsi singkat" maxlength="500"></textarea>
        <label>Gambar</label>
        <input type="file" name="image" accept="image/*">
        <button type="submit">Generate Link</button>
      </form>
    </div>
    <h2>Riwayat Anda</h2>
    <div class="grid">${history || '<p class="muted">Belum ada riwayat.</p>'}</div>
  `));
});

app.post('/generate', upload.single('image'), (req, res) => {
  const { shopeeLink, title, desc = '' } = req.body;

  if (!isValidShopeeUrl(shopeeLink)) {
    return res.status(400).send(layout(`<div class="danger">Link harus domain Shopee resmi.</div><a class="btn" href="/">Kembali</a>`));
  }

  const id = nanoid(10);
  const db = readDb();
  db[id] = {
    shopeeLink,
    title,
    desc,
    img: req.file ? `/uploads/${req.file.filename}` : '',
    createdAt: new Date().toISOString(),
  };
  writeDb(db);
  res.redirect(`/?id=${id}`);
});

app.get('/r/:id', (req, res) => {
  const db = readDb();
  const item = db[req.params.id];
  if (!item) return res.status(404).send(layout('<div class="card"><h1>Link tidak ditemukan</h1><a class="btn" href="/">Kembali</a></div>'));

  res.send(`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2;url=${escapeHtml(item.shopeeLink)}" />
  <title>${escapeHtml(item.title)}</title>
  <style>body{font-family:Arial,sans-serif;background:#fff7f4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{max-width:520px;background:white;padding:28px;border-radius:20px;box-shadow:0 12px 35px rgba(0,0,0,.1);text-align:center}img{max-width:100%;border-radius:14px}.btn{display:inline-block;background:#ee4d2d;color:#fff;padding:12px 16px;border-radius:10px;text-decoration:none;font-weight:700}</style>
</head>
<body>
  <div class="box">
    <p>Menuju halaman produk...</p>
    ${item.img ? `<img src="${escapeHtml(item.img)}" alt="${escapeHtml(item.title)}">` : ''}
    <h1>${escapeHtml(item.title)}</h1>
    <p>${escapeHtml(item.desc)}</p>
    <p>Memuat konten...</p>
    <a class="btn" href="${escapeHtml(item.shopeeLink)}">Buka Sekarang</a>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`ShopeeAF Node jalan di http://localhost:${PORT}`);
});
