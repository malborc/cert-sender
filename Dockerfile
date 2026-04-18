FROM node:20-alpine

# Build tools needed as fallback if prebuilt binaries are unavailable
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app

# Install dependencies at image build time (not at container start)
COPY package.json .
RUN npm install --omit=dev && npm cache clean --force

# Source code is mounted as a volume in docker-compose for easy updates
# COPY here acts as a fallback if no volume is mounted
COPY src ./src
COPY public ./public
