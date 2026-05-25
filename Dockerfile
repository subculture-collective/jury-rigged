# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY vite.config.ts ./
COPY vite.app.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY src ./src
COPY app ./app
COPY dashboard ./dashboard
COPY public ./public
COPY db ./db

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/db ./db

EXPOSE 3001

CMD ["sh", "-c", "npm run migrate:dist && npm run start"]
