FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.html app.js style.css ui-feedback.js ./
COPY scripts/build-static.js ./scripts/build-static.js
COPY frontend ./frontend
RUN npm run build

COPY server.js openai-oauth-image.js oauth-flow.js background-jobs.js image-storage.js image-watermark.js prompt-enhancement.js config-service.js proxy-policy.js proxy-executor.js request-limits.js account-store.js account-store-file.js account-store-upstash.js account-store-capabilities.js ./
COPY api ./api
COPY netlify ./netlify
COPY handlers ./handlers
COPY config/.env.example ./config/.env.example

EXPOSE 3000

CMD ["node", "server.js"]
