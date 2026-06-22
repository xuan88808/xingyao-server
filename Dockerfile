FROM node:22-bookworm

# better-sqlite3 需要 C++ 编译环境（bookworm 已内置 gcc/g++）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# 强制从源码编译 better-sqlite3
RUN npm install --build-from-source --production && npm cache clean --force

COPY . .

RUN mkdir -p /app/data /app/uploads

EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "index.js"]
