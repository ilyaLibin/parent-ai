FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./

# Copy shared package
COPY packages/shared ./packages/shared

# Copy api package
COPY packages/api ./packages/api

# Install workspace dependencies
RUN npm ci --workspace=packages/api --workspace=packages/shared

EXPOSE 3033
WORKDIR /app/packages/api
CMD ["node", "--import", "tsx", "src/index.ts"]
