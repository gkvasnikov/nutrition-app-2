# Official Playwright image: Ubuntu + Node 20 + Chromium + all system libraries
# preinstalled and version-matched to playwright 1.60.0 (see package.json).
# This fixes "error while loading shared libraries: libglib-2.0.so.0" that
# occurs under nixpacks, where Chromium's system deps are not installed.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# 1. Install server (root) dependencies
COPY package*.json ./
RUN npm ci

# 2. Copy the full source
COPY . .

# 3. Ensure the Chromium build matching this playwright version is present.
#    (System deps already exist in the base image — no --with-deps needed.)
RUN npx playwright install chromium

# 4. Build the frontend (Vite). Runs before NODE_ENV=production so dev deps install.
# VITE_ vars must be available at build time — declare as ARG so Railway passes them in.
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
RUN cd frontend && npm ci && npm run build

ENV NODE_ENV=production
# Railway injects PORT at runtime; server.js falls back to 3001 locally.
EXPOSE 3001

CMD ["node", "server.js"]
