# Orca desktop under Xvfb, driven over the Chrome DevTools Protocol by Playwright, to capture the
# screenshot install guide. Based on tools/platform-test/Dockerfile.
#   docker build -t orca-guide:<orca-version> --build-arg ORCA_VERSION=<orca-version> tools/install-guide
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=Asia/Seoul
ARG MIRROR=https://mirror.kakao.com/ubuntu
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "60";\nAcquire::https::Timeout "60";\n' > /etc/apt/apt.conf.d/80-retries \
 && for i in 1 2 3 4 5 6; do \
      (apt-get update && apt-get install -y --no-install-recommends ca-certificates) && break; \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb; sleep 5; \
    done \
 && sed -i -E "s#http://(archive|security)\.ubuntu\.com/ubuntu/?#${MIRROR}#g" \
      /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null; \
    for i in 1 2 3 4 5; do apt-get update && break; sleep 10; done

# Fonts: CJK (ko/ja/zh-CN/zh-TW), Latin/Cyrillic/Turkish (Noto core, DejaVu, Liberation), emoji.
RUN apt-get install -y --no-install-recommends \
      ca-certificates curl git jq xvfb xauth dbus-x11 x11-utils xdotool \
      fonts-noto-cjk fonts-noto-core fonts-noto-color-emoji fonts-liberation fonts-dejavu-core \
      python3 python3-pil pngquant nodejs npm \
 && rm -rf /var/lib/apt/lists/*

# Playwright client only (it attaches to Orca's own Electron over CDP; no browser download).
RUN mkdir -p /opt/pw && cd /opt/pw && npm init -y >/dev/null && npm install --no-audit --no-fund playwright-core@1.48.2

ARG ORCA_VERSION=1.4.279
RUN curl -fsSL --retry 5 --retry-all-errors --connect-timeout 30 -o /tmp/orca.deb \
      "https://github.com/stablyai/orca/releases/download/v${ORCA_VERSION}/orca-ide_${ORCA_VERSION}_amd64.deb" \
 && ok=; for i in 1 2 3 4; do \
      (apt-get update && apt-get install -y --no-install-recommends /tmp/orca.deb) && { ok=1; break; }; \
      rm -rf /var/lib/apt/lists/*; sleep 20; \
    done; [ -n "$ok" ] \
 && rm -f /tmp/orca.deb && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash tester
USER tester
WORKDIR /home/tester
ENV NODE_PATH=/opt/pw/node_modules
