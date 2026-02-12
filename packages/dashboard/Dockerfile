FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/dashboard ./packages/dashboard

RUN npm ci --workspace=packages/dashboard

FROM node:20-slim AS builder

WORKDIR /app

COPY --from=deps /app .

ENV API_URL=http://api:3033

RUN npm run build --workspace=packages/dashboard

FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3333
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static

EXPOSE 3333

CMD ["node", "packages/dashboard/server.js"]
