# The sandbox image for a bot's computer. Build from images/computer:
#   docker build -t brot-computer:latest images/computer
#
# It holds tools and the pinned DeepSeek Harness, and no secrets. DSH_VERSION must match the pin in
# packages/engines/package.json; apps/server/src/computers/docker.test.ts checks that.
FROM node:24-slim

ARG DSH_VERSION=0.2.1-rc.2
ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@deepseek-ai/dsh@${DSH_VERSION}" \
 && npm cache clean --force

RUN mkdir -p /workspace && chown node:node /workspace
VOLUME ["/workspace"]

USER node
WORKDIR /workspace
ENV HOME=/home/node
CMD ["sleep", "infinity"]
