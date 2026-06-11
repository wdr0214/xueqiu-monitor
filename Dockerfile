FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

COPY package.json ./
COPY src ./src
COPY config ./config

RUN mkdir -p /app/data

CMD ["node", "src/index.js"]
