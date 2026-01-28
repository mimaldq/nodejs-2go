# 阶段1：构建阶段
FROM node:18.20.8-alpine AS builder

# 安装构建工具（如果需要编译原生模块）
# 如果没有原生模块依赖，可以移除这些工具
RUN apk add --no-cache \
    python3 \
    make \
    g++

WORKDIR /app

# 复制package文件
COPY package*.json ./

# 如果有package-lock.json，使用npm ci，否则使用npm install
# npm ci 更快更可靠，但需要package-lock.json
RUN if [ -f package-lock.json ]; then \
      npm ci --only=production; \
    else \
      npm install --only=production; \
    fi

# 复制应用代码
COPY . .

# 阶段2：运行时阶段
FROM node:18.20.8-alpine

# 仅安装运行时必要的包
RUN apk add --no-cache curl

# 创建非root用户和目录
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 \
    && mkdir -p /app/tmp \
    && chown -R nodejs:nodejs /app \
    && chmod -R 755 /app

WORKDIR /app

# 从构建阶段复制必要的文件
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/*.js ./
COPY --from=builder --chown=nodejs:nodejs /app/index.html ./

# 设置为非root用户
USER nodejs

EXPOSE 7860

CMD ["node", "index.js"]
