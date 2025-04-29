import os
import time
import requests
from pathlib import Path
from urllib.parse import urljoin
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# ----------------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------------
TARGET_URL = "https://www.onlinedoctranslator.com/en/translationform"
INPUT_FILE_PATH = "document.pdf"
DOWNLOAD_DIR = Path("./indirilenler").resolve()
HEADLESS = True
API_KEY = "3e71c09ed20cd28f6588180347c17070"  # Your 2Captcha key

class SELECTORS:
    COOKIES_ACCEPT_BTN = "//html/body/div[4]/div[1]/div/div/div/p/span/button[3]"
    FILE_INPUT = "input[type=file]"
    FROM_SELECT = "select#from"
    TO_SELECT = "select#to"
    TRANSLATE_BUTTON = "input#translation-button"
    DOWNLOAD_LINK = "a#download-link"

# ----------------------------------------------------------------------------
# CAPTCHA Solver
# ----------------------------------------------------------------------------
def solve_recaptcha(site_key, url):
    print("[INFO] 2Captcha çözüm başlatılıyor...")
    resp = requests.post("http://2captcha.com/in.php", data={
        'key': API_KEY,
        'method': 'userrecaptcha',
        'googlekey': site_key,
        'pageurl': url,
        'json': 1
    })
    request_id = resp.json()['request']
    print("[INFO] Task ID:", request_id)

    for _ in range(30):
        time.sleep(5)
        check = requests.get("http://2captcha.com/res.php", params={
            'key': API_KEY,
            'action': 'get',
            'id': request_id,
            'json': 1
        }).json()
        if check['status'] == 1:
            return check['request']
    raise Exception("CAPTCHA çözümü zaman aşımına uğradı.")

# ----------------------------------------------------------------------------
# Main Flow
# ----------------------------------------------------------------------------
def main():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    options = webdriver.ChromeOptions()
    if HEADLESS:
        options.add_argument("--headless=new")
    options.add_experimental_option("prefs", {
        "download.default_directory": str(DOWNLOAD_DIR),
        "safebrowsing.enabled": True,
        "download.prompt_for_download": False
    })

    driver = webdriver.Chrome(options=options)
    wait = WebDriverWait(driver, 30)

    try:
        driver.get(TARGET_URL)
        print("[INFO] Site açılıyor...\n")

        try:
            wait.until(EC.element_to_be_clickable((By.XPATH, SELECTORS.COOKIES_ACCEPT_BTN))).click()
            print("[INFO] Çerez popup kapatıldı\n")
        except:
            print("[INFO] Çerez popup görünmedi, devam...\n")

        # Dil seçimleri
        Select(wait.until(EC.presence_of_element_located((By.ID, "from")))).select_by_value("tr")
        Select(wait.until(EC.presence_of_element_located((By.ID, "to")))).select_by_value("en")

        # Dosya yüklemesi
        file_input = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, SELECTORS.FILE_INPUT)))
        file_input.send_keys(os.path.abspath(INPUT_FILE_PATH))
        print("\n📤 Dosya gönderildi, CAPTCHA aktif...\n")

        # Sitekey yakala
        time.sleep(2)
        iframe = driver.find_element(By.CSS_SELECTOR, "iframe[src*='recaptcha']")
        src = iframe.get_attribute("src")
        site_key = src.split("k=")[1].split("&")[0]
        print("[INFO] Site key bulundu:", site_key)

        # 2Captcha ile çöz
        token = solve_recaptcha(site_key, TARGET_URL)
        print("\n[INFO] CAPTCHA token alındı:\n", token)

        # Token'ı textarea'ya enjekte et
        driver.execute_script("""
            const token = arguments[0];
            let textarea = document.querySelector("textarea[name='g-recaptcha-response']");
            if (!textarea) {
                textarea = document.createElement("textarea");
                textarea.name = "g-recaptcha-response";
                textarea.style = "display:none";
                document.querySelector("form").appendChild(textarea);
            }
            textarea.value = token;
        """, token)

        # Callback fonksiyonunu tetikle
        driver.execute_script("""
            if (typeof recaptchaCallbackTranslator === 'function') {
                recaptchaCallbackTranslator(arguments[0]);
            }
        """, token)

        print("\n✅ reCAPTCHA token enjekte edildi ve callback tetiklendi")

        # Translate butonuna tıkla
        print("[INFO] Translate butonu aktifleşmesi bekleniyor...\n")
        translate_btn = WebDriverWait(driver, 30).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, SELECTORS.TRANSLATE_BUTTON))
        )
        driver.execute_script("arguments[0].click();", translate_btn)
        print("✅ Translate butonuna tıklandı!\n")

        # Çeviri işlemi için bekle
        print("[INFO] Çeviri işlemi bekleniyor...\n")
        time.sleep(20)

        # Download linkini bul
        download_elem = WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, SELECTORS.DOWNLOAD_LINK))
        )
        download_href = download_elem.get_attribute("href")
        print(f"[INFO] Download link bulundu: {download_href}")

        # Browser'dan çıkmadan cookies al
        cookies = {c['name']: c['value'] for c in driver.get_cookies()}
        session = requests.Session()
        for name, value in cookies.items():
            session.cookies.set(name, value)

        # Download
        filename = download_href.split("/")[-1]
        response = session.get(download_href)
        with open(DOWNLOAD_DIR / filename, "wb") as f:
            f.write(response.content)
        print(f"✅ Dosya indirildi: {filename}")

        time.sleep(5)

    finally:
        driver.quit()

if __name__ == "__main__":
    main()