import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
dotenv.config();

const TARGET_URL = 'https://www.onlinedoctranslator.com/en/translationform';
const FILE_PATH = './2025_CS4Science_Part1.pdf';
const API_KEY = process.env.API_KEY;
const DOWNLOAD_DIR = './translated';
const TARGET_LANGUAGE = 'tr';

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

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 0 });

  await page.select('#to', TARGET_LANGUAGE);
  console.log(`🌐 Hedef dil "${TARGET_LANGUAGE}" olarak seçildi.`);

  const fileInput = await page.$('input[type="file"]');
  const absolutePath = path.resolve(FILE_PATH);
  await fileInput.uploadFile(absolutePath);
  console.log('📤 Dosya yüklendi.');

  await page.waitForSelector('iframe[src*="recaptcha"]');
  const frameEl = await page.$('iframe[src*="recaptcha"]');
  const src = await frameEl.evaluate(el => el.getAttribute('src'));
  const sitekey = src.split('k=')[1].split('&')[0];
  console.log('🔑 Sitekey:', sitekey);

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
    if (typeof recaptchaCallbackTranslator === 'function') {
      recaptchaCallbackTranslator(token);
    }
  }, token);
  console.log('✅ CAPTCHA token enjekte edildi ve callback tetiklendi.');

  await new Promise(resolve => setTimeout(resolve, 10000));
  console.log('⏳ 10 saniye bekleme tamamlandı. Translate tetiklenecek.');

  await page.waitForSelector('#translation-button', { timeout: 60000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('#translation-button');
    return button && !button.disabled;
  }, { timeout: 60000 });

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
  console.log('📘 Translate butonuna arka planda tıklama tetiklendi.');

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
  console.log('📄 Yeni çeviri sayfası yüklendi.');
  await new Promise(resolve => setTimeout(resolve, 5000));

  const downloadHref = await page.evaluate(() => {
    const link = document.querySelector('#download-link');
    return link ? link.getAttribute('href') : null;
  });

  if (downloadHref) {
    const fullUrl = downloadHref.startsWith('http')
      ? downloadHref
      : `https://www.onlinedoctranslator.com${downloadHref}`;

    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
    const fileName = path.basename(fullUrl).split('?')[0];
    const destination = path.join(DOWNLOAD_DIR, fileName);

    await downloadWithPuppeteerFetch(page, fullUrl, destination);
    console.log('✅ Dosya başarıyla indirildi:', destination);

    // ✅ Python scriptini çağır
    console.log('⚙️ Python scripti tetikleniyor...');
    const py = spawn('python', ['process_translated_pdf.py', FILE_PATH, destination]);

    py.stdout.on('data', data => {
      console.log('📘 Python çıktı:', data.toString());
    });

    py.stderr.on('data', data => {
      console.error('⚠️ Python stderr:', data.toString());
    });

    py.on('close', code => {
      console.log(`🎯 Python scripti tamamlandı. Kod: ${code}`);
    });

  } else {
    console.log('⚠️ İndirme bağlantısı bulunamadı.');
  }

  await browser.close();
})();