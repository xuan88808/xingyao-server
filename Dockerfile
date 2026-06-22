# ── Railway 部署 Dockerfile ──
# better-sqlite3 需要 C++ 编译环境，用 slim 镜像 + 手动装工具链（比 full 镜像小 400MB）

FROM node:22-slim

# 安装 better-sqlite3 编译依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制 package.json 利用 Docker 层缓存
COPY package.json ./
RUN npm install --production

# 复制源码
COPY . .

# 确保持久化目录存在（后续挂载 Volume）
RUN mkdir -p /app/data /app/uploads

# 默认端口（Railway 会通过 PORT 环境变量覆盖）
EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "index.js"]
