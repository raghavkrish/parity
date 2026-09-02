FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY fixtures ./fixtures

RUN npm run build

ENV PORT=3000
ENV MAX_PAGES=25
ENV MONGODB_DB=parity
EXPOSE 3000

CMD ["node", "dist/web.js"]
