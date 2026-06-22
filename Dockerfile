FROM node:22-slim

# better-sqlite3 需要完整的 C++ 编译工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（利用 Docker 层缓存）
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# 复制源码
COPY . .

# 确保数据目录存在
RUN mkdir -p /app/data /app/uploads

EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "index.js"]
