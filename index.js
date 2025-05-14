// ✅ index.js — Streaming destekli, progress bar ile uyumlu tam çalışan backend

import puppeteer from 'puppeteer';
import { executablePath } from 'puppeteer';
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
import { execSync } from 'child_process';

let chromiumPath;
try {
  chromiumPath = execSync('which chromium').toString().trim();
  console.log('✅ Chromium path:', chromiumPath);
} catch (err) {
  console.error('❌ Chromium not found:', err.message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const DOWNLOAD_DIR = path.join(__dirname, 'translated');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

const {
  TARGET_SITE_URL,
  CAPTCHA_SUBMIT_URL,
  CAPTCHA_RESULT_URL,
  API_KEY
} = process.env;

function getChromiumPath() {
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/bin/chromium-browser',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}


async function solveCaptcha(sitekey, pageUrl) {
  console.log('🔍 Starting CAPTCHA solving process...');
 

  const form = new FormData();
  form.append('key', API_KEY);
  form.append('method', 'userrecaptcha');
  form.append('googlekey', sitekey);
  form.append('pageurl', pageUrl);
  form.append('json', 1);

  console.log('📤 Sending CAPTCHA request to 2captcha...');
  const res = await fetch(CAPTCHA_SUBMIT_URL, { method: 'POST', body: form });
  const { request: requestId } = await res.json();
  console.log('📥 Received request ID:', requestId);

  for (let i = 0; i < 24; i++) {
    console.log(`⏳ Waiting for CAPTCHA solution... (Attempt ${i + 1}/24)`);
    await new Promise(res => setTimeout(res, 5000));
    const check = await fetch(`${CAPTCHA_RESULT_URL}?key=${API_KEY}&action=get&id=${requestId}&json=1`);
    const result = await check.json();
    if (result.status === 1) {
      console.log('✅ CAPTCHA solved successfully!');
      return result.request;
    }
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

async function runTranslationWithStream(filePath, targetLanguage, res) {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: getChromiumPath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    defaultViewport: null,
  });
  
  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(30000); // 30 seconds timeout
    
    console.log('🌐 Navigating to target website...');
    await page.goto(TARGET_SITE_URL, { 
      waitUntil: 'domcontentloaded', // Changed from networkidle0
      timeout: 30000 
    });

    res.write('Detecting source language\n');

    console.log('🔍 Waiting for language selector...');
    await page.waitForSelector('select[name="to"]', { timeout: 10000 });
    
    // Wait for the select element to be fully loaded and interactive
    await page.waitForFunction(() => {
      const select = document.querySelector('select[name="to"]');
      return select && select.options.length > 0;
    }, { timeout: 10000 });
    
    console.log('📝 Selecting target language:', targetLanguage);
    await page.select('select[name="to"]', targetLanguage);
    
    // Wait for language selection to take effect
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Clear any existing files in the dropzone
    await page.evaluate(() => {
      const dropzone = document.querySelector('.dropzone');
      if (dropzone && dropzone.files) {
        dropzone.files = new DataTransfer().files;
      }
    });
    
    console.log('📤 Uploading file...');
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(path.resolve(filePath));
    
    // Wait for file to be processed
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔍 Waiting for CAPTCHA iframe...');
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 10000 });
    const frameEl = await page.$('iframe[src*="recaptcha"]');
    const src = await frameEl.evaluate(el => el.getAttribute('src'));
    const sitekey = src.split('k=')[1].split('&')[0];
    
    res.write('Solving CAPTCHA...\n');
    
    const token = await solveCaptcha(sitekey, TARGET_SITE_URL);

    console.log('📝 Injecting CAPTCHA token...');
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
    
    // Wait for CAPTCHA verification
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('✅ CAPTCHA token injected');

    res.write('CAPTCHA solved, proceeding with translation...\n');

    console.log('⏳ Waiting for translation button...');
    await page.waitForSelector('#translation-button', { timeout: 10000 });
    
    // Wait for button to be enabled
    await page.waitForFunction(() => {
      const button = document.querySelector('#translation-button');
      return button && !button.disabled;
    }, { timeout: 60000 });

    // Click the button using a proper event
    await page.evaluate(() => {
      const button = document.querySelector('#translation-button');
      if (button) {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        button.dispatchEvent(event);
      }
    });
    console.log('✅ Translation button clicked with proper event');

    // Wait for navigation and page load
    await page.waitForNavigation({ 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    console.log('✅ Navigation completed');
    
    // Additional wait for page to stabilize
    await new Promise(resolve => setTimeout(resolve, 5000));

    res.write('Starting translation\n');

    // İndirme bağlantısını bul ve doğrula
    const downloadHref = await page.evaluate(() => {
      const link = document.querySelector('#download-link');
      if (!link) {
        console.log('Download link not found, checking alternative selectors...');
        // Alternatif seçicileri dene
        const altLink = document.querySelector('a[href*="gettranslateddocument"]') || 
                       document.querySelector('a[href*="download"]') ||
                       document.querySelector('a[href*=".pdf"]');
        return altLink ? altLink.getAttribute('href') : null;
      }
      return link.getAttribute('href');
    });

    if (!downloadHref) {
      console.log('Available elements on page:');
      const pageContent = await page.content();
      console.log(pageContent);
      throw new Error('⚠️ Download link not found');
    }

    console.log('✅ Download link found:', downloadHref);

    const fullUrl = downloadHref.startsWith('http') 
      ? downloadHref 
      : `${new URL(TARGET_SITE_URL).origin}${downloadHref}`;

    const originalFilename = path.basename(filePath, '.pdf');
    const downloadFileName = path.basename(downloadHref);
    const langMatch = downloadFileName.match(/\.([a-z]{2})\.([a-z]{2})\.pdf$/);

    if (!langMatch) {
      throw new Error('⚠️ Language codes could not be parsed from download filename.');
    }

    const sourceLang = langMatch[1];
    const targetLang = langMatch[2];

    const fileName = `${originalFilename}_${sourceLang}.${targetLang}.pdf`;
    const destination = path.join(DOWNLOAD_DIR, fileName);

    res.write('Downloading translated file...\n');

    // İndirme işlemini daha güvenilir hale getir
    try {
      await downloadWithPuppeteerFetch(page, fullUrl, destination);
      console.log('✅ File downloaded successfully to:', destination);
      
      // Dosyanın başarıyla indirildiğini doğrula
      if (!fs.existsSync(destination)) {
        throw new Error('Downloaded file not found on disk');
      }
      
      const stats = fs.statSync(destination);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      console.log('✅ File verification successful:', {
        path: destination,
        size: stats.size,
        created: stats.birthtime
      });
    } catch (error) {
      console.error('❌ Download error:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }

    res.write('Processing PDF\n');

    const py = spawn(path.resolve('./myenv/bin/python'), [
      'process_translated_pdf.py',
      filePath,  // original file
      destination,  // translated file
      targetLang  // to_lang
    ]);

    return await new Promise((resolve, reject) => {
      let singleFile = null;
      let mergedFile = null;
      let errorOutput = '';

      py.stdout.on('data', data => {
        const output = data.toString();
        console.log('Python stdout:', output);
        res.write(output);
        
        const singleMatch = output.match(/Single: ([^\n]+)/);
        const mergedMatch = output.match(/Merged: ([^\n]+)/);
        
        if (singleMatch) singleFile = singleMatch[1].trim();
        if (mergedMatch) mergedFile = mergedMatch[1].trim();
      });

      py.stderr.on('data', data => {
        const error = data.toString();
        errorOutput += error;
        console.error('Python stderr:', error);
        res.write(`[PYTHON ERROR] ${error}`);
      });

      py.on('close', code => {
        console.log('Python process exited with code:', code);
        if (code === 0 && singleFile && mergedFile) {
          resolve({
            single: `translated/${singleFile}`,
            merged: `translated/${mergedFile}`
          });
        } else {
          const errorMessage = `Python script failed with code ${code}. Error output: ${errorOutput}`;
          console.error(errorMessage);
          reject(new Error(errorMessage));
        }
      });

      py.on('error', (err) => {
        console.error('Failed to start Python process:', err);
        reject(new Error(`Failed to start Python process: ${err.message}`));
      });
    });
  } finally {
    await browser.close();
  }
}

app.post('/api/translate', upload.single('pdf'), async (req, res) => {
  // Set headers for streaming response
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

    console.log('📄 Starting translation process for:', req.file.originalname);
    console.log('🎯 Target language:', targetLanguage);

    const result = await runTranslationWithStream(filePath, targetLanguage, res);
    res.write(JSON.stringify({ success: true, files: result }) + '\n');
    res.write('Translation completed\n');
    res.end();

    try { fs.unlinkSync(filePath); } catch {}
  } catch (err) {
    console.error('❌ Translation error:', err);
    res.write(`❌ Error: ${err.message}\n`);
    res.end();
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const filePath = req.query.file;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    // URL decode the file path and resolve it relative to the project root
    const decodedPath = decodeURIComponent(filePath);
    const absolutePath = path.join(__dirname, decodedPath);

    console.log('Download request:', {
      requestedPath: filePath,
      decodedPath: decodedPath,
      absolutePath: absolutePath
    });

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      console.error('File not found:', absolutePath);
      return res.status(404).json({ 
        error: 'File not found',
        details: {
          requestedPath: filePath,
          absolutePath: absolutePath
        }
      });
    }

    // Get file stats
    const stats = fs.statSync(absolutePath);
    if (stats.size === 0) {
      return res.status(400).json({ error: 'File is empty' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(decodedPath)}`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Create read stream and pipe to response
    const fileStream = fs.createReadStream(absolutePath);

    fileStream.on('error', (error) => {
      console.error('Error reading file:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Error reading file',
          details: error.message
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('Download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        details: error.message
      });
    }
  }
});

// Add a route to check if file exists
app.get('/api/check-file', (req, res) => {
  try {
    const filePath = req.query.file;
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const decodedPath = decodeURIComponent(filePath);
    const absolutePath = path.join(__dirname, decodedPath);
    const exists = fs.existsSync(absolutePath);

    res.json({
      exists,
      path: decodedPath,
      absolutePath: absolutePath
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

app.get('/api/test-chrome', async (req, res) => {
  try {
    const chromePath = getChromiumPath();
    console.log('Chromium path:', chromePath);
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: null,
    });
    await browser.close();
    res.send('Chromium çalışıyor! Path: ' + chromePath);
  } catch (e) {
    res.status(500).send('Chromium açılmıyor: ' + e.message);
  }
});

const DIST_PATH = path.join(__dirname, 'dist');
app.use(express.static(DIST_PATH));
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});

//