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

# A template, not a finished config: the nginx image's entrypoint runs
# envsubst over /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at
# start, which is how ${PORT} gets a value. A PaaS assigns the port at
# runtime, so a hardcoded `listen` means its health check never connects.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# Restricts envsubst to $PORT alone. Without this it would also expand
# nginx's own $uri in try_files — to empty, since it is not an environment
# variable — silently breaking SPA deep links.
ENV NGINX_ENVSUBST_FILTER=PORT
# Local default; a PaaS overrides it.
ENV PORT=5173

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1

CMD ["nginx", "-g", "daemon off;"]
