FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
COPY index.html app.js style.css server.js openai-oauth-image.js ./
COPY api ./api
COPY netlify ./netlify

EXPOSE 3000

CMD ["node", "server.js"]
