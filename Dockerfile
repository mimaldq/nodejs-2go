# 阶段1：构建阶段
FROM node:18.20.8-alpine AS builder

WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装生产依赖 - 没有原生模块，不需要构建工具
RUN npm install --only=production

# 复制应用代码
COPY . .

# 阶段2：运行时阶段
FROM node:18.20.8-alpine

# 创建非root用户
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 \
    && mkdir -p /app/tmp \
    && chown -R nodejs:nodejs /app \
    && chmod -R 755 /app

WORKDIR /app

# 从构建阶段复制node_modules
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# 复制应用代码
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs *.js ./
COPY --chown=nodejs:nodejs index.html ./

USER nodejs

EXPOSE 7860

CMD ["node", "index.js"]
