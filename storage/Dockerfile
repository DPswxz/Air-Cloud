# syntax=docker/dockerfile:1
FROM golang:1.26-trixie AS builder
WORKDIR /source
ADD --checksum=sha256:310a475de6eeb1d3e43a4df0ada0091a042487afb2a749e18c5c2d8c9aedd80f https://codeload.github.com/drakkan/sftpgo/tar.gz/62ae9ba3957e9ed52b44a4f885e805e2d7b35972 /tmp/source.tar.gz
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 -C /source
COPY storage/month-session.patch /tmp/month-session.patch
RUN git apply /tmp/month-session.patch
COPY storage/share-pages.patch /tmp/share-pages.patch
RUN git apply /tmp/share-pages.patch
COPY storage/air_shares.go /source/internal/httpd/air_shares.go
ENV GOFLAGS=-mod=readonly
RUN go build -trimpath -ldflags "-s -w" -o /tmp/sftpgo .

FROM drakkan/sftpgo:v2.7.6
COPY --from=builder /tmp/sftpgo /usr/local/bin/sftpgo
COPY --from=builder /source/templates /usr/share/sftpgo/templates
COPY storage/entrypoint.sh /usr/local/bin/browsernas-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/browsernas-entrypoint.sh"]
CMD ["sftpgo", "serve"]
