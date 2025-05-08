import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
dotenv.config();

const TARGET_URL = process.env.TARGET_SITE_URL;
const CAPTCHA_SUBMIT_URL = process.env.CAPTCHA_SUBMIT_URL;
const CAPTCHA_RESULT_URL = process.env.CAPTCHA_RESULT_URL;
const API_KEY = process.env.API_KEY;
const FILE_PATH = './document.pdf';
const DOWNLOAD_DIR = './translated';
const TARGET_LANGUAGE = 'de'; // You can change this as needed

async function solveCaptcha(sitekey, pageUrl) {
  const form = new FormData();
  form.append('key', API_KEY);
  form.append('method', 'userrecaptcha');
  form.append('googlekey', sitekey);
  form.append('pageurl', pageUrl);
  form.append('json', 1);

  const res = await fetch(CAPTCHA_SUBMIT_URL, { method: 'POST', body: form });
  const { request: requestId } = await res.json();

  console.log('⏳ CAPTCHA submitted, waiting for solution...');
  for (let i = 0; i < 24; i++) {
    await new Promise(res => setTimeout(res, 5000));
    const check = await fetch(`${CAPTCHA_RESULT_URL}?key=${API_KEY}&action=get&id=${requestId}&json=1`);
    const result = await check.json();
    if (result.status === 1) {
      console.log('✅ CAPTCHA solved.');
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

async function runTranslation() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 0 });

  await page.select('#to', TARGET_LANGUAGE);
  console.log(`🌐 Target language selected: "${TARGET_LANGUAGE}"`);

  const fileInput = await page.$('input[type="file"]');
  const absolutePath = path.resolve(FILE_PATH);
  await fileInput.uploadFile(absolutePath);
  console.log('📤 File uploaded.');

  await page.waitForSelector('iframe[src*="recaptcha"]');
  const frameEl = await page.$('iframe[src*="recaptcha"]');
  const src = await frameEl.evaluate(el => el.getAttribute('src'));
  const sitekey = src.split('k=')[1].split('&')[0];
  console.log('🔑 Sitekey detected:', sitekey);

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
  console.log('✅ CAPTCHA token injected and callback triggered.');

  await new Promise(resolve => setTimeout(resolve, 10000));
  console.log('⏳ Waiting 10 seconds before submitting translation...');

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
  console.log('📘 Translate button clicked.');

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
  console.log('📄 Translation result page loaded.');
  await new Promise(resolve => setTimeout(resolve, 5000));

  const downloadHref = await page.evaluate(() => {
    const link = document.querySelector('#download-link');
    return link ? link.getAttribute('href') : null;
  });

  if (!downloadHref) {
    throw new Error('⚠️ Download link not found.');
  }

  const fullUrl = downloadHref.startsWith('http')
    ? downloadHref
    : `${new URL(TARGET_URL).origin}${downloadHref}`;

  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
  const fileName = path.basename(fullUrl).split('?')[0];
  const destination = path.join(DOWNLOAD_DIR, fileName);

  await downloadWithPuppeteerFetch(page, fullUrl, destination);
  console.log('✅ File successfully downloaded:', destination);

  // Run Python script
  console.log('⚙️ Launching post-processing script...');
  const pythonPath = path.resolve('./myenv/bin/python'); // Adjust for your system if needed
  const py = spawn(pythonPath, [
    'process_translated_pdf.py',
    FILE_PATH,
    destination,
    TARGET_LANGUAGE
  ]);

  py.stdout.on('data', data => {
    console.log('📘 Python output:', data.toString());
  });

  py.stderr.on('data', data => {
    console.error('⚠️ Python error:', data.toString());
  });

  py.on('close', code => {
    console.log(`🎯 Python script exited with code: ${code}`);
    if (code === 0) {
      console.log("✅ Process complete. Exiting.");
      process.exit(0);
    } else {
      console.log("⚠️ Python script failed.");
    }
  });

  await browser.close();
}

// Retry mechanism (max 3 attempts)
let success = false;

for (let attempt = 1; attempt <= 3; attempt++) {
  console.log(`\n🔁 Attempt ${attempt}...`);
  try {
    await runTranslation();
    success = true;
    break;
  } catch (err) {
    console.error(`❌ Attempt ${attempt} failed:`, err.message);
    if (attempt < 3) {
      console.log('⏳ Retrying...');
    }
  }
}

if (!success) {
  console.error('\n🚨 All 3 attempts failed. Exiting.');
  process.exit(1);
}