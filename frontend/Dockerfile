# syntax=docker/dockerfile:1.7

FROM node:22.17-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_ENABLE_DEMO_MODE=true
ARG VITE_EMERGENCY_NUMBER=

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_ENABLE_DEMO_MODE=${VITE_ENABLE_DEMO_MODE}
ENV VITE_EMERGENCY_NUMBER=${VITE_EMERGENCY_NUMBER}

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  --mount=type=secret,id=npm_ca,required=false \
  if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
  npm ci --prefer-offline --no-audit --no-fund --maxsockets=4

COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5173/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
