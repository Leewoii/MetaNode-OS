FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/distribution-api/package.json apps/distribution-api/package.json
RUN npm install --workspace apps/distribution-api
COPY apps/distribution-api apps/distribution-api
RUN npm --workspace apps/distribution-api run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/distribution-api/package.json apps/distribution-api/package.json
RUN npm install --omit=dev --workspace apps/distribution-api
COPY --from=build /app/apps/distribution-api/dist apps/distribution-api/dist
EXPOSE 4320
CMD ["npm", "--workspace", "apps/distribution-api", "run", "start"]
