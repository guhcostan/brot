# The bot desktop image: a Xvfb screen, openbox, and Chromium, driven through brot-browser and xdotool.
# Build after the computer image:
#   docker build -t brot-computer:latest images/computer
#   docker build -t brot-desktop:latest images/desktop
FROM brot-computer:latest

ARG PLAYWRIGHT_CORE_VERSION=1.64.1
ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    DISPLAY=:1 \
    DESKTOP_WIDTH=1280 \
    DESKTOP_HEIGHT=800

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb openbox chromium xdotool imagemagick fonts-noto fonts-noto-color-emoji dbus-x11 \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "playwright-core@${PLAYWRIGHT_CORE_VERSION}" \
 && npm cache clean --force

COPY brot-desktop-start /usr/local/bin/brot-desktop-start
COPY brot-browser.mjs /usr/local/bin/brot-browser
RUN chmod 0755 /usr/local/bin/brot-desktop-start /usr/local/bin/brot-browser

USER node
WORKDIR /workspace
# The container runs the desktop, then keeps the container alive. brot-desktop-start is idempotent.
CMD ["sh", "-c", "brot-desktop-start && exec sleep infinity"]
