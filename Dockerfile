FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev
COPY index.html app.js style.css server.js openai-oauth-image.js oauth-flow.js ui-feedback.js background-jobs.js image-storage.js image-watermark.js prompt-enhancement.js ./
COPY api ./api
COPY netlify ./netlify

EXPOSE 3000

CMD ["node", "server.js"]
