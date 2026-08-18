# syntax=docker/dockerfile:1.7

FROM node:22.17-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_ENABLE_DEMO_MODE=true
ARG VITE_EMERGENCY_NUMBER=

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_ENABLE_DEMO_MODE=${VITE_ENABLE_DEMO_MODE}
ENV VITE_EMERGENCY_NUMBER=${VITE_EMERGENCY_NUMBER}

# Vite inlines VITE_* at BUILD time, so a wrong value here cannot be fixed by
# restarting the container — it is baked into the JS bundle and needs a
# rebuild. That makes a silently-wrong default expensive, and localhost:8000
# is exactly that: in a visitor's browser "localhost" is THEIR machine, so a
# hosted build carrying the default produces an app that fails for every user
# while working perfectly on the developer's laptop.
#
# Observed in a real deploy: requests went same-origin to the static host and
# came back "405 Not Allowed" from nginx, which looks like a frontend bug and
# is not one — the API URL was simply never supplied at build time.
#
# Rather than fail (a local `docker build` with no args is legitimate), warn
# loudly at build time AND again at container start, so the message lands in
# the deploy logs where someone debugging a hosted app will actually look.
RUN set -e; \
    case "$VITE_API_BASE_URL" in \
      ""|*localhost*|*127.0.0.1*) \
        echo "WARNING: VITE_API_BASE_URL=${VITE_API_BASE_URL} is baked into this bundle."; \
        echo "         Fine for local development. In a HOSTED deploy it is broken:"; \
        echo "         localhost is the VISITOR's machine, so requests never reach the"; \
        echo "         API — they hit this static host and nginx answers 405 Not Allowed."; \
        echo "         Rebuild with --build-arg VITE_API_BASE_URL=https://your-api-url"; \
        ;; \
      *) echo "Bundle will call the API at ${VITE_API_BASE_URL}" ;; \
    esac

# A build ARG rather than --mount=type=secret: not every builder supports
# BuildKit secrets. Railway's rejects `type=secret` at parse time ("other
# mount types are not supported"), failing the build before any layer runs.
# An ARG parses everywhere.
#
# Safe here only because this is a PUBLIC certificate — the root CA of a TLS
# interceptor, not a key — and ARG values are recorded in image history.
# Never pass a real credential this way.
#
# Empty on any normal network (including Railway); locally:
#   docker build --build-arg BUILD_CA="$(cat corp-root.crt)" ...
ARG BUILD_CA=""

COPY package.json package-lock.json ./
RUN if [ -n "$BUILD_CA" ]; then \
      printf '%s\n' "$BUILD_CA" > /tmp/build_ca.crt \
      && export NODE_EXTRA_CA_CERTS=/tmp/build_ca.crt; \
    fi; \
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
