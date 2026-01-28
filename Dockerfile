FROM node:18.20.8-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install --only=production

COPY . .

FROM node:18.20.8-alpine

RUN apk add --no-cache curl

RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001

WORKDIR /app

RUN mkdir -p /app/tmp \
    && chown -R nodejs:nodejs /app \
    && chmod -R 755 /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs *.js ./
COPY --chown=nodejs:nodejs index.html ./

USER nodejs

EXPOSE 7860

CMD ["node", "index.js"]
