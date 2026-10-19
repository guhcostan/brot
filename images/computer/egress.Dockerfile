# The egress sidecar for one bot's computer: the proxy and Brot relay in apps/server/src/computers/egress-proxy.ts.
# Build from the repository root, with that directory as the context:
#   docker build -f images/computer/egress.Dockerfile -t brot-egress:latest apps/server/src/computers
#
# The file is copied as .mts so Node treats it as an ES module. Node 24 type-strips it at startup, so there is
# no install or build step. It imports only Node built-ins.
FROM node:24-slim

COPY egress-proxy.ts /opt/brot/egress-proxy.mts
USER node
ENTRYPOINT ["node", "/opt/brot/egress-proxy.mts"]
