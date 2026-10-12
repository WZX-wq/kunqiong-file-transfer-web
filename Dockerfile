FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8045
ENV KUNQIONG_HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/email-templates ./email-templates

EXPOSE 8045
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8045) + '/api/health').then(async r => { if (!r.ok || !(await r.json()).ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
