# 1. Aşama: Frontend'i build et (Vite/React için)
FROM node:20-slim AS frontend

WORKDIR /app

# Sadece package dosyalarını kopyala ve install
COPY package*.json ./
RUN npm install

# Tüm kodu kopyala ve build et
COPY . .
RUN npm run build    # Vite ile dist/ klasörü oluşur

# 2. Aşama: Production için backend image'ı oluştur
FROM node:20-slim

# Gerekli bağımlılıkları yükle
RUN apt-get update && apt-get install -y \
  wget \
  ca-certificates \
  fonts-liberation \
  fonts-noto-color-emoji \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  xdg-utils \
  chromium \
  python3 \
  python3-pip \
  python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Sadece production bağımlılıklarını yükle
COPY package*.json ./
RUN npm install --omit=dev

# Backend dosyalarını ve frontend'in build edilmiş dist/ klasörünü kopyala
COPY --from=frontend /app/dist ./dist
COPY . .
# Python Sanal Ortam ve Gereksinimler
RUN apt-get update && apt-get install -y \
  python3 python3-pip python3-venv python3-wheel \
  && python3 -m venv /app/myenv \
  && . /app/myenv/bin/activate \
  && pip install --upgrade pip \
  && pip install --break-system-packages PyMuPDF python-dotenv\
  && pip3 install --break-system-packages PyMuPDF python-dotenv\
  && pip install --break-system-packages -r requirements.txt
# Puppeteer'a chromium path ver
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Başlatıcı komut
CMD ["npm", "start"]