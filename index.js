// === PDFTranslator - Full Express Backend ===
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOAD_DIR = path.join(__dirname, 'translated');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DIST_PATH = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 8080;

// --- Ensure Directories Exist ---
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Chromium Path Finder ---
function findChromiumPath() {
  const tryPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome'
  ];
  for (const p of tryPaths) if (fs.existsSync(p)) return p;
  try {
    return execSync('which chromium || which chromium-browser || which google-chrome').toString().trim();
  } catch {
    return undefined;
  }
}

// --- Multer Upload ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// --- CAPTCHA Solver ---
async function solveCaptcha(sitekey, pageUrl) {
  const { API_KEY, CAPTCHA_SUBMIT_URL, CAPTCHA_RESULT_URL } = process.env;
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
  throw new Error('❌ CAPTCHA çözülmedi.');
}

// --- Puppeteer File Download ---
async function downloadWithPuppeteerFetch(page, url, destinationPath) {
  const buffer = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, url);
  fs.writeFileSync(destinationPath, Buffer.from(buffer));
}

// --- Main Translation Function ---
async function runTranslationWithStream(filePath, targetLanguage, res) {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: findChromiumPath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.goto(process.env.TARGET_SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    res.write('Detecting source language\n');
    await page.waitForSelector('select[name="to"]', { timeout: 15000 });
    await page.waitForFunction(() => {
      const select = document.querySelector('select[name="to"]');
      return select && select.options.length > 0;
    }, { timeout: 10000 });
    await page.select('select[name="to"]', targetLanguage);
    await new Promise(res => setTimeout(res, 2000));
    await page.evaluate(() => {
      const dropzone = document.querySelector('.dropzone');
      if (dropzone && dropzone.files) {
        dropzone.files = new DataTransfer().files;
      }
    });
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(path.resolve(filePath));
    await new Promise(res => setTimeout(res, 5000));
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 30000 });
    const frameEl = await page.$('iframe[src*="recaptcha"]');
    const src = await frameEl.evaluate(el => el.getAttribute('src'));
    const sitekey = src.split('k=')[1].split('&')[0];
    res.write('Solving CAPTCHA...\n');
    const token = await solveCaptcha(sitekey, process.env.TARGET_SITE_URL);
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
    await new Promise(resolve => setTimeout(resolve, 2000));
    res.write('CAPTCHA solved, proceeding with translation...\n');
    await page.waitForSelector('#translation-button', { timeout: 10000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('#translation-button');
      return button && !button.disabled;
    }, { timeout: 60000 });
    await page.evaluate(() => {
      const button = document.querySelector('#translation-button');
      if (button) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        button.dispatchEvent(event);
      }
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 4000));
    res.write('Starting translation\n');
    const downloadHref = await page.evaluate(() => {
      const link = document.querySelector('#download-link');
      if (!link) {
        const altLink = document.querySelector('a[href*="gettranslateddocument"]') ||
          document.querySelector('a[href*="download"]') ||
          document.querySelector('a[href*=".pdf"]');
        return altLink ? altLink.getAttribute('href') : null;
      }
      return link.getAttribute('href');
    });
    if (!downloadHref) throw new Error('Download link not found');
    const fullUrl = downloadHref.startsWith('http') ? downloadHref : `${new URL(process.env.TARGET_SITE_URL).origin}${downloadHref}`;
    const originalFilename = path.basename(filePath, '.pdf');
    const downloadFileName = path.basename(downloadHref);
    const langMatch = downloadFileName.match(/\.([a-z]{2})\.([a-z]{2})\.pdf$/);
    if (!langMatch) throw new Error('Language codes could not be parsed from download filename.');
    const sourceLang = langMatch[1];
    const targetLang = langMatch[2];
    const fileName = `${originalFilename}_${sourceLang}.${targetLang}.pdf`;
    const destination = path.join(DOWNLOAD_DIR, fileName);
    res.write('Downloading translated file...\n');
    await downloadWithPuppeteerFetch(page, fullUrl, destination);
    if (!fs.existsSync(destination) || fs.statSync(destination).size === 0)
      throw new Error('Downloaded file not found or empty');
    res.write('Processing PDF\n');
    const py = spawn(path.resolve('./myenv/bin/python'), [
      'process_translated_pdf.py',
      filePath,
      destination,
      targetLang
    ]);
    return await new Promise((resolve, reject) => {
      let singleFile = null, mergedFile = null, errorOutput = '';
      py.stdout.on('data', data => {
        const output = data.toString();
        res.write(output);
        const singleMatch = output.match(/Single: ([^\n]+)/);
        const mergedMatch = output.match(/Merged: ([^\n]+)/);
        if (singleMatch) singleFile = singleMatch[1].trim();
        if (mergedMatch) mergedFile = mergedMatch[1].trim();
      });
      py.stderr.on('data', data => {
        const error = data.toString();
        errorOutput += error;
        res.write(`[PYTHON ERROR] ${error}`);
      });
      py.on('close', code => {
        if (code === 0 && singleFile && mergedFile) {
          resolve({ single: `translated/${singleFile}`, merged: `translated/${mergedFile}` });
        } else {
          reject(new Error(`Python script failed with code ${code}. Error output: ${errorOutput}`));
        }
      });
      py.on('error', (err) => reject(new Error(`Failed to start Python process: ${err.message}`)));
    });
  } finally {
    await browser.close();
  }
}

// --- Express Server ---
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.post('/api/translate', upload.single('pdf'), async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const filePath = path.join(UPLOAD_DIR, req.file.originalname);
    const targetLanguage = req.body.targetLanguage || 'de';
    if (!req.file) {
      res.write('❌ No PDF file uploaded\n');
      return res.end();
    }
    const result = await runTranslationWithStream(filePath, targetLanguage, res);
    res.write(JSON.stringify({ success: true, files: result }) + '\n');
    res.write('Translation completed\n');
    res.end();
    try { fs.unlinkSync(filePath); } catch {}
  } catch (err) {
    res.write(`❌ Error: ${err.message}\n`);
    res.end();
  }
});

// Download endpoint
app.get('/api/download', async (req, res) => {
  try {
    const filePath = req.query.file;
    if (!filePath) return res.status(400).json({ error: 'File path is required' });
    const decodedPath = decodeURIComponent(filePath);
    const absolutePath = path.join(__dirname, decodedPath);
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'File not found' });
    const stats = fs.statSync(absolutePath);
    if (stats.size === 0) return res.status(400).json({ error: 'File is empty' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(decodedPath)}`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    fs.createReadStream(absolutePath).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Check file endpoint
app.get('/api/check-file', (req, res) => {
  try {
    const filePath = req.query.file;
    if (!filePath) return res.status(400).json({ error: 'File path is required' });
    const decodedPath = decodeURIComponent(filePath);
    const absolutePath = path.join(__dirname, decodedPath);
    res.json({ exists: fs.existsSync(absolutePath), path: decodedPath, absolutePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test chrome endpoint
app.get('/api/test-chrome', async (req, res) => {
  try {
    const chromePath = findChromiumPath();
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote'
      ],
      protocolTimeout: 120000
    });
    await browser.close();
    res.send('Chromium çalışıyor! Path: ' + chromePath);
  } catch (e) {
    res.status(500).send('Chromium açılmıyor: ' + e.message);
  }
});

// Liveness endpoint
app.get('/api/hello', (req, res) => res.json({ message: 'Backend is working!' }));

// Frontend Serve
app.use(express.static(DIST_PATH));
app.get('*', (req, res) => res.sendFile(path.join(DIST_PATH, 'index.html')));

app.listen(PORT, () => {
  console.log(`[pdftranslator] [${new Date().toISOString()}] ✅ Chromium path: ${findChromiumPath()}`);
  console.log(`[pdftranslator] [${new Date().toISOString()}] 🚀 Server running at http://localhost:${PORT}`);
});