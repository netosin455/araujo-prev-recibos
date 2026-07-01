FROM node:24-slim
WORKDIR /app
COPY web/package*.json ./
RUN npm ci --omit=dev
COPY web/ .
EXPOSE 3000
CMD ["node", "server.js"]
