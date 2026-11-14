# GLHF platform image: the engine (Pi Durable run tracker and drug board) and the built dashboard,
# with uv for the benchmark harness and the Docker CLI for the agents' sandbox.
# Keys are never copied in: .env is in .dockerignore and is passed at run time by docker compose.
FROM node:26-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git curl \
 && rm -rf /var/lib/apt/lists/*
# Pinned, so a rebuild gives the same tools. Raise the versions on purpose, not by accident.
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /usr/local/bin/
COPY --from=docker:29.8.2-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29.8.2-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
ENV UV_LINK_MODE=copy UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN uv python install 3.12 && docker compose version

FROM base AS dashboard
WORKDIR /build
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
ARG VITE_ENGINE_URL=http://localhost:8787
RUN VITE_ENGINE_URL=$VITE_ENGINE_URL npx vite build

FROM base
COPY --from=dashboard /build/dist /srv/dashboard
COPY docker/serve.mjs /srv/serve.mjs
COPY docker/entrypoint.sh /usr/local/bin/glhf-entrypoint
ENTRYPOINT ["glhf-entrypoint"]
CMD ["node", "engine/src/server.ts"]
