FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./

# Copy shared package
COPY packages/shared ./packages/shared

# Copy listener package
COPY packages/listener ./packages/listener

# Install workspace dependencies
RUN npm ci --workspace=packages/listener --workspace=packages/shared

WORKDIR /app/packages/listener
CMD ["node", "--import", "tsx", "src/index.ts"]
