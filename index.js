import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const DOWNLOAD_DIR = path.join(__dirname, 'translated');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

const requiredEnvVars = [
  'TARGET_SITE_URL',
  'CAPTCHA_SUBMIT_URL',
  'CAPTCHA_RESULT_URL',
  'API_KEY'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.use(express.json());

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

['uploads', 'translated'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

const {
  TARGET_SITE_URL,
  CAPTCHA_SUBMIT_URL,
  CAPTCHA_RESULT_URL,
  API_KEY
} = process.env;

async function solveCaptcha(sitekey, pageUrl) {
  const form = new FormData();
  form.append('key', API_KEY);
  form.append('method', 'userrecaptcha');
  form.append('googlekey', sitekey);
  form.append('pageurl', pageUrl);
  form.append('json', 1);

  const res = await fetch(CAPTCHA_SUBMIT_URL, { method: 'POST', body: form });
  const { request: requestId } = await res.json();

  for (let i = 0; i < 24; i++) {
    await new Promise(res => setTimeout(res, 5000));
    const check = await fetch(`${CAPTCHA_RESULT_URL}?key=${API_KEY}&action=get&id=${requestId}&json=1`);
    const result = await check.json();
    if (result.status === 1) return result.request;
  }
  throw new Error('❌ CAPTCHA could not be solved.');
}

async function downloadWithPuppeteerFetch(page, url, destinationPath) {
  const buffer = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, url);
  fs.writeFileSync(destinationPath, Buffer.from(buffer));
}

async function runTranslation(filePath, targetLanguage) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(TARGET_SITE_URL, { waitUntil: 'networkidle2', timeout: 0 });

    await page.waitForSelector('select[name="to"]', { timeout: 10000 });

    await page.evaluate((lang) => {
      const select = document.querySelector('select[name="to"]');
      if (select) {
        select.value = lang;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, targetLanguage);

    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(path.resolve(filePath));

    await page.waitForSelector('iframe[src*="recaptcha"]');
    const frameEl = await page.$('iframe[src*="recaptcha"]');
    const src = await frameEl.evaluate(el => el.getAttribute('src'));
    const sitekey = src.split('k=')[1].split('&')[0];
    const token = await solveCaptcha(sitekey, TARGET_SITE_URL);

    await page.evaluate(token => {
      let textarea = document.querySelector("textarea[name='g-recaptcha-response']");
      if (!textarea) {
        textarea = document.createElement("textarea");
        textarea.name = "g-recaptcha-response";
        textarea.style = "display:none";
        document.querySelector("form").appendChild(textarea);
      }
      textarea.value = token;
      if (typeof recaptchaCallbackTranslator === 'function') {
        recaptchaCallbackTranslator(token);
      }
    }, token);

    await new Promise(resolve => setTimeout(resolve, 10000));
    await page.waitForSelector('#translation-button');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#translation-button');
      return btn && !btn.disabled;
    });

    await page.evaluate(() => {
      const btn = document.querySelector('#translation-button');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    const downloadHref = await page.evaluate(() => {
      const link = document.querySelector('#download-link');
      return link ? link.getAttribute('href') : null;
    });

    if (!downloadHref) throw new Error('⚠️ Download link not found.');

    const fullUrl = downloadHref.startsWith('http')
      ? downloadHref
      : `${new URL(TARGET_SITE_URL).origin}${downloadHref}`;

    const originalFilename = path.basename(filePath, '.pdf');
    const downloadFileName = path.basename(downloadHref);
    const langMatch = downloadFileName.match(/\.([a-z]{2})\.([a-z]{2})\.pdf$/);

    if (!langMatch) throw new Error('⚠️ Language codes could not be parsed from download filename.');

    const sourceLang = langMatch[1];
    const targetLang = langMatch[2];

    const fileName = `${originalFilename}_${sourceLang}.${targetLang}.pdf`;
    const destination = path.join(DOWNLOAD_DIR, fileName);

    await downloadWithPuppeteerFetch(page, fullUrl, destination);
    console.log('✅ File successfully downloaded:', destination);

    console.log('⚙️ Launching post-processing script...');
    const pythonPath = path.resolve('./myenv/bin/python');
    const py = spawn(pythonPath, [
      'process_translated_pdf.py',
      filePath,
      destination,
      targetLang
    ]);

    return new Promise((resolve, reject) => {
      let singleFile = null;
      let mergedFile = null;
      let errorOutput = '';

      py.stdout.on('data', data => {
        const output = data.toString();
        console.log('[PYTHON]', output);

        const singleMatch = output.match(/Single: ([^\n]+)/);
        const mergedMatch = output.match(/Merged: ([^\n]+)/);

        if (singleMatch) singleFile = singleMatch[1].trim();
        if (mergedMatch) mergedFile = mergedMatch[1].trim();
      });

      py.stderr.on('data', data => {
        const error = data.toString();
        console.error('[PYTHON ERROR]', error);
        errorOutput += error;
      });

      py.on('close', code => {
        if (code === 0 && singleFile && mergedFile) {
          resolve({
            single: `translated/${singleFile}`,
            merged: `translated/${mergedFile}`
          });
        } else {
          reject(new Error(`Python script failed: ${errorOutput}`));
        }
      });
    });
  } finally {
    await browser.close();
  }
}

app.post('/api/translate', upload.single('pdf'), async (req, res) => {
  try {
    const filePath = path.join('./uploads', req.file.originalname);
    const targetLanguage = req.body.targetLanguage || 'de';

    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    const result = await runTranslation(filePath, targetLanguage);

    res.json({
      success: true,
      files: result
    });

    try { fs.unlinkSync(filePath); } catch {}
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download', async (req, res) => {
  const filePath = req.query.file;
  if (!filePath) return res.status(400).json({ error: 'File path is required' });

  const decodedPath = decodeURIComponent(filePath);
  const absolutePath = path.join(__dirname, decodedPath);

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(decodedPath)}`);
    const fileStream = fs.createReadStream(absolutePath);

    fileStream.on('error', (error) => {
      console.error('Error reading file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading file' });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});