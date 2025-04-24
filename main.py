import os
import time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from pypasser import reCaptchaV3
from RecaptchaSolver import RecaptchaSolver

# -----------------------------------------------------------------------------
# Ayarlar
# -----------------------------------------------------------------------------
TARGET_URL = "https://www.onlinedoctranslator.com/en/translationform"
INPUT_FILE_PATH = "temp.pdf"
DOWNLOAD_DIR = Path("./indirilenler").resolve()
TARGET_LANGUAGE_VALUE = "tr"
FILENAME = "translated_output.pdf"
HEADLESS = True

class SELECTORS:
    COOKIES_ACCEPT_BTN = "//html/body/div[4]/div[1]/div/div/div/p/span/button[3]"
    AFTER_COOKIES_BTN = "//html/body/div/div/div[3]/div[2]/div[1]/div[1]/div[2]/button"
    FILE_INPUT = "input[type=file]"
    FROM_SELECT = "select#from"
    TO_SELECT = "select#to"
    TRANSLATE_BUTTON = "input#translation-button"
    DONE_TEXT = "//*[contains(text(), 'All done!')]"
    DOWNLOAD_LINK = "//a[@id='download-link']"

# -----------------------------------------------------------------------------
# Yardımcı Fonksiyonlar
# -----------------------------------------------------------------------------
def wait_and_rename_file(directory: Path, final_name: str, timeout=60) -> Path:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for file in directory.iterdir():
            if file.name.startswith(".com.google.Chrome") or file.name.endswith(".pdf"):
                if file.stat().st_size == 0:
                    time.sleep(1)
                    continue
                new_path = directory / final_name
                file.rename(new_path)
                return new_path
        time.sleep(1)
    raise TimeoutError("İndirme tamamlanmadı.")

# -----------------------------------------------------------------------------
# Ana Akış
# -----------------------------------------------------------------------------
def main() -> None:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    chrome_opts = webdriver.ChromeOptions()
    chrome_opts.add_experimental_option("prefs", {
        "download.default_directory": str(DOWNLOAD_DIR),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    })
    chrome_opts.add_argument("--disable-dev-shm-usage")
    chrome_opts.add_argument("--no-sandbox")
    chrome_opts.add_argument("--incognito")
    chrome_opts.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
    )
    chrome_opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_opts.add_experimental_option("useAutomationExtension", False)
    chrome_opts.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    chrome_opts.add_experimental_option("useAutomationExtension", False)
    if HEADLESS:
        chrome_opts.add_argument("--headless")

    driver = webdriver.Chrome(options=chrome_opts)
    wait = WebDriverWait(driver, 20)

    try:
        driver.get(TARGET_URL)

        try:
            wait.until(EC.element_to_be_clickable((By.XPATH, SELECTORS.COOKIES_ACCEPT_BTN))).click()
        except Exception:
            pass

        from_select = Select(wait.until(EC.presence_of_element_located((By.ID, "from"))))
        from_select.select_by_value("en")

        to_select = Select(wait.until(EC.presence_of_element_located((By.ID, "to"))))
        to_select.select_by_value("tr")

        file_input = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, SELECTORS.FILE_INPUT)))
        file_input.send_keys(os.path.abspath(INPUT_FILE_PATH))

        time.sleep(3)

        try:
            wait.until(EC.element_to_be_clickable((By.XPATH, SELECTORS.AFTER_COOKIES_BTN))).click()
        except Exception:
            pass

        anchor_iframe = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "iframe[src*='recaptcha'][src*='anchor']")
        ))
        anchor_url = anchor_iframe.get_attribute("src")
        print(f"[INFO] reCAPTCHA anchor URL:\n{anchor_url}")

        token = reCaptchaV3(anchor_url, timeout=20)
        RecaptchaSolver(driver).inject_token(token)

        translate_button = wait.until(EC.presence_of_element_located((By.ID, "translation-button")))
        for _ in range(40):
            if not translate_button.get_attribute("disabled"):
                break
            time.sleep(0.2)
        else:
            raise Exception("Aktif translate butonu bulunamadı!")

        driver.execute_script("arguments[0].click();", translate_button)

        wait.until(EC.presence_of_element_located((By.XPATH, SELECTORS.DONE_TEXT)))
        download_link = wait.until(EC.element_to_be_clickable((By.XPATH, SELECTORS.DOWNLOAD_LINK)))
        driver.execute_script("arguments[0].click();", download_link)

        translated_file = wait_and_rename_file(DOWNLOAD_DIR, FILENAME)
        print(f"✓ Dosya indirildi ve kaydedildi: {translated_file}")

    finally:
        driver.quit()

if __name__ == "__main__":
    main()
