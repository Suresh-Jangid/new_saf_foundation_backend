FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci

COPY tsconfig.json ./
COPY src ./src/
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=5000

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist
COPY public ./public/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p uploads

EXPOSE 5000
ENTRYPOINT ["./docker-entrypoint.sh"]
