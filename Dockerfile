# Official Playwright image: Ubuntu + Node 20 + Chromium + all system libraries
# preinstalled and version-matched to playwright 1.60.0 (see package.json).
# Chromium is already in the base image — no separate install step needed.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# 1. Install server (root) dependencies — cached until package.json changes
COPY package*.json ./
RUN npm ci

# 2. Install frontend dependencies — cached until frontend/package.json changes
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# 3. Copy full source and build frontend
COPY . .
RUN cd frontend && npm run build

ENV NODE_ENV=production
# Railway injects PORT at runtime; server.js falls back to 3001 locally.
EXPOSE 3001

CMD ["node", "server.js"]
