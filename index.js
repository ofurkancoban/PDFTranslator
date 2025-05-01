// translate_and_clean.js (Python arka planda çalışır, süreç Node'da başlar ve biter)
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
dotenv.config();

const FILE_PATH = './2025_CS4Science_Part1.pdf';
const DOWNLOAD_DIR = './translated';
const TARGET_LANGUAGE = 'es';
const API_KEY = process.env.API_KEY;
const TARGET_URL = 'https://www.onlinedoctranslator.com/en/translationform';

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

async function translatePDF() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

  await page.select('#to', TARGET_LANGUAGE);
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile(path.resolve(FILE_PATH));
  console.log('📤 Dosya yüklendi.');

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

  await page.waitForSelector('#translation-button', { timeout: 50000 });
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

  const buffer = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, fullUrl);

  fs.writeFileSync(translatedPath, Buffer.from(buffer));
  await browser.close();
  console.log('✅ Çeviri indirildi:', translatedPath);
  return translatedPath;
}

(async () => {
  try {
    const translated = await translatePDF();
    console.log('🚀 Python ile işleniyor...');
    execSync(`python process_translated_pdf.py "${FILE_PATH}" "${translated}"`, { stdio: 'inherit' });
    console.log('🎉 PDF işleme tamamlandı. merged.pdf hazır.');
  } catch (err) {
    console.error('❌ Hata:', err.message);
  }
})();
