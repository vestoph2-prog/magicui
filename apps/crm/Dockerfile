# Build from the repository root:
#   docker build -f apps/crm/Dockerfile -t crm apps/crm
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/crm.db
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
