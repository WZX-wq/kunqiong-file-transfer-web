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
COPY --from=build /app/dist ./dist
COPY --from=build /app/email-templates ./email-templates

EXPOSE 8045
CMD ["node", "server.mjs"]
