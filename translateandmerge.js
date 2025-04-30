import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { PDFDocument, rgb } from 'pdf-lib';
import dotenv from 'dotenv';
dotenv.config();

const FILE_PATH = './02_SSM_-_Case_study_Chris_Thompson.pdf'; // Orijinal PDF
const DOWNLOAD_DIR = './translated';
const TARGET_LANGUAGE = 'tr';
const API_KEY = process.env.API_KEY;
const TARGET_URL = 'https://www.onlinedoctranslator.com/en/translationform';

// 2Captcha çözümü
async function solveCaptcha(sitekey, pageUrl) {
  const form = new FormData();
  form.append('key', API_KEY);
  form.append('method', 'userrecaptcha');
  form.append('googlekey', sitekey);
  form.append('pageurl', pageUrl);
  form.append('json', 1);

  const res = await fetch('http://2captcha.com/in.php', { method: 'POST', body: form });
  const { request: requestId } = await res.json();

  console.log('⏳ CAPTCHA gönderildi, çözüm bekleniyor...');
  for (let i = 0; i < 24; i++) {
    await new Promise(res => setTimeout(res, 5000));
    const check = await fetch(`http://2captcha.com/res.php?key=${API_KEY}&action=get&id=${requestId}&json=1`);
    const result = await check.json();
    if (result.status === 1) {
      console.log('✅ CAPTCHA çözüldü.');
      return result.request;
    }
  }
  throw new Error('❌ CAPTCHA çözülmedi.');
}

async function downloadWithPuppeteerFetch(page, url, destinationPath) {
  const buffer = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, url);
  fs.writeFileSync(destinationPath, Buffer.from(buffer));
}

async function translatePDF() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

  // Dil seç
  await page.select('#to', TARGET_LANGUAGE);
  const fileInput = await page.$('input[type="file"]');
  const absolutePath = path.resolve(FILE_PATH);
  await fileInput.uploadFile(absolutePath);
  console.log('📤 Dosya yüklendi.');

  // CAPTCHA çöz
  await page.waitForSelector('iframe[src*="recaptcha"]');
  const frameEl = await page.$('iframe[src*="recaptcha"]');
  const src = await frameEl.evaluate(el => el.getAttribute('src'));
  const sitekey = src.split('k=')[1].split('&')[0];
  const token = await solveCaptcha(sitekey, TARGET_URL);

  await page.evaluate(token => {
    let textarea = document.querySelector("textarea[name='g-recaptcha-response']");
    if (!textarea) {
      textarea = document.createElement("textarea");
      textarea.name = "g-recaptcha-response";
      textarea.style = "display:none";
      document.querySelector("form").appendChild(textarea);
    }
    textarea.value = token;
    if (typeof recaptchaCallbackTranslator === 'function') recaptchaCallbackTranslator(token);
  }, token);

  await page.waitForSelector('#translation-button', { timeout: 30000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('#translation-button');
    return btn && !btn.disabled;
  });
  await page.evaluate(() => {
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    document.querySelector('#translation-button').dispatchEvent(evt);
  });

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const downloadHref = await page.evaluate(() => {
    const link = document.querySelector('#download-link');
    return link ? link.getAttribute('href') : null;
  });

  if (!downloadHref) throw new Error('⚠️ İndirme bağlantısı bulunamadı.');

  const fullUrl = downloadHref.startsWith('http') ? downloadHref : `https://www.onlinedoctranslator.com${downloadHref}`;
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
  const fileName = path.basename(fullUrl).split('?')[0];
  const translatedPath = path.join(DOWNLOAD_DIR, fileName);

  await downloadWithPuppeteerFetch(page, fullUrl, translatedPath);
  await browser.close();
  console.log('✅ Çeviri indirildi:', translatedPath);

  return translatedPath;
}

async function mergeSideBySide(originalPath, translatedPath, outputPath) {
  const origBytes = fs.readFileSync(originalPath);
  const transBytes = fs.readFileSync(translatedPath);

  const [origPdf, transPdf, outputPdf] = await Promise.all([
    PDFDocument.load(origBytes),
    PDFDocument.load(transBytes),
    PDFDocument.create(),
  ]);

  const origPageCount = origPdf.getPageCount();
  const transPageCount = transPdf.getPageCount();

  const pageCount = Math.min(origPageCount, transPageCount);

  for (let i = 0; i < pageCount; i++) {
    const origPage = await outputPdf.embedPage(origPdf.getPage(i));
    const transPage = await outputPdf.embedPage(transPdf.getPage(i));

    const width = origPage.width;
    const height = origPage.height;

    const newPage = outputPdf.addPage([width * 2, height]);

    newPage.drawPage(origPage, { x: 0, y: 0 });
    newPage.drawPage(transPage, { x: width, y: 0 });

    newPage.drawLine({
      start: { x: width, y: 0 },
      end: { x: width, y: height },
      thickness: 1.5,
      color: rgb(0.6, 0.6, 0.6), // gri çizgi
    });
  }

  const mergedBytes = await outputPdf.save();
  fs.writeFileSync(outputPath, mergedBytes);
  console.log('✅ Birleştirilmiş PDF oluşturuldu:', outputPath);
}

// ANA AKIŞ
(async () => {
  try {
    const translated = await translatePDF();
    await mergeSideBySide(FILE_PATH, translated, './merged.pdf');
  } catch (err) {
    console.error('❌ Hata:', err.message);
  }
})();