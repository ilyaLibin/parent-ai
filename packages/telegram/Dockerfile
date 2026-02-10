FROM node:20-slim

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./

# Copy telegram package
COPY packages/telegram ./packages/telegram

# Install workspace dependencies
RUN npm ci --workspace=packages/telegram

WORKDIR /app/packages/telegram
CMD ["node", "--import", "tsx", "src/index.ts"]
