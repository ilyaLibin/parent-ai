FROM node:20-slim

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./

# Copy cron package
COPY packages/cron ./packages/cron

# Install workspace dependencies
RUN npm ci --workspace=packages/cron

WORKDIR /app/packages/cron
CMD ["node", "--import", "tsx", "src/index.ts"]
