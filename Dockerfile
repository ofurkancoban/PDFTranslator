FROM node:20-slim

# System Dependencies
RUN apt-get update && apt-get install -y \
  wget \
  python3 python3-pip python3-venv \
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
  && rm -rf /var/lib/apt/lists/*

# Chromium
RUN apt-get update && apt-get install -y chromium

# Çalışma dizini
WORKDIR /app

# Node.js Bağımlılıkları
COPY package*.json ./
RUN npm install

COPY . .                # kodlar kopyalanır

RUN npm run build       # <-- dist oluşturulur

# Python Sanal Ortam ve Gereksinimler
RUN python3 -m venv myenv && \
    . myenv/bin/activate && \
    pip install --upgrade pip && \
    pip install -r requirements.txt

# Ortam değişkenleri
ENV PORT=8080
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Uygulama başlat
CMD ["npm", "start"]