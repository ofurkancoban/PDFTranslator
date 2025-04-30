import streamlit as st
import requests

st.title("📄 PDF Çeviri Uygulaması")

language = st.selectbox("Hedef dili seçin", ["en", "de", "fr", "tr"])
translate = st.button("Çeviriyi Başlat")

if translate:
    with st.spinner("Çeviri işlemi başlatılıyor..."):
        response = requests.post(
            "http://localhost:3001/translate",
            json={"targetLanguage": language}
        )
        if response.status_code == 200:
            st.success("✅ Çeviri tamamlandı! `translated` klasörünü kontrol edin.")
        else:
            st.error("❌ Bir hata oluştu.")