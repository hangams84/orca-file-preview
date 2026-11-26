# Orca desktop on Ubuntu under a virtual display, for installing and testing the File Preview
# plugin inside a real Orca build. Build with --build-arg UBUNTU=22.04|24.04.
#   docker build -t orca-fp:24.04 --build-arg UBUNTU=24.04 tools/platform-test
ARG UBUNTU=24.04
FROM ubuntu:${UBUNTU}
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=Asia/Seoul
# Plain-HTTP package downloads were intermittently altered on the way (Hash Sum mismatch on several
# mirrors), so bootstrap CA certificates over HTTP with retries, then use an HTTPS mirror.
ARG MIRROR=https://mirror.kakao.com/ubuntu
# A stalled mirror connection must fail and retry, not hang the build until the CI job times out.
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "60";\nAcquire::https::Timeout "60";\n' > /etc/apt/apt.conf.d/80-retries \
 && for i in 1 2 3 4 5 6; do \
      (apt-get update && apt-get install -y --no-install-recommends ca-certificates) && break; \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb; sleep 5; \
    done \
 && sed -i -E "s#http://(archive|security)\.ubuntu\.com/ubuntu/?#${MIRROR}#g" \
      /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null; \
    for i in 1 2 3 4 5; do apt-get update && break; sleep 10; done

# Xvfb + a D-Bus session for Electron, CJK fonts for Korean text, git for plugin installs from Git.
RUN apt-get install -y --no-install-recommends \
      ca-certificates curl git jq xvfb xauth dbus-x11 x11-utils xdotool \
      fonts-noto-cjk fonts-noto-color-emoji fonts-liberation fonts-dejavu-core \
      python3 \
 && rm -rf /var/lib/apt/lists/*

# Declared here, after the shared layers, so every Orca version reuses the cached base layers.
ARG ORCA_VERSION=1.4.258
# Orca's own .deb pulls in the Electron runtime libraries it declares.
RUN curl -fsSL --retry 5 --retry-all-errors --connect-timeout 30 --speed-limit 100000 --speed-time 60 -o /tmp/orca.deb \
      "https://github.com/stablyai/orca/releases/download/v${ORCA_VERSION}/orca-ide_${ORCA_VERSION}_amd64.deb" \
 && ok=; for i in 1 2 3 4; do \
      # A mirror mid-sync can 404 a package the index still lists: refresh the index and try again.
      (apt-get update && apt-get install -y --no-install-recommends /tmp/orca.deb) && { ok=1; break; }; \
      rm -rf /var/lib/apt/lists/*; sleep 20; \
    done; [ -n "$ok" ] \
 && rm -f /tmp/orca.deb && rm -rf /var/lib/apt/lists/*

# Orca refuses to run its desktop app as root without a sandbox; use a normal user.
RUN useradd -m -s /bin/bash tester
USER tester
WORKDIR /home/tester
COPY --chown=tester:tester run-tests.sh /home/tester/run-tests.sh
ENTRYPOINT ["/bin/bash", "/home/tester/run-tests.sh"]
