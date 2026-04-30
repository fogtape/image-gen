FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV IMAGE_GEN_RUNTIME=node
ENV IMAGE_GEN_DATA_DIR=/app/data

COPY package*.json ./
RUN apk add --no-cache su-exec && npm ci --omit=dev

COPY index.html app.js style.css ui-feedback.js ./
COPY scripts/build-static.js ./scripts/build-static.js
COPY frontend ./frontend
RUN npm run build

COPY server.js openai-oauth-image.js oauth-flow.js background-jobs.js image-storage.js image-watermark.js prompt-enhancement.js config-service.js proxy-policy.js proxy-executor.js request-limits.js oauth-request-limits.js account-store.js account-store-file.js account-store-upstash.js account-store-capabilities.js mutex.js rate-limiter.js proof-worker.js proof-worker-runner.js pow-config.js ./
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY api ./api
COPY netlify ./netlify
COPY handlers ./handlers
COPY config/.env.example ./config/.env.example

# Ensure data and config directories exist and are owned by node user
RUN mkdir -p /app/data /app/config \
  && chown -R node:node /app/data /app/config \
  && chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3000

# Healthcheck: verify the server responds on the main page
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://localhost:${PORT}/ || exit 1

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
