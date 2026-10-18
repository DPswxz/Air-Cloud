# syntax=docker/dockerfile:1
FROM golang:1.26-trixie AS builder
WORKDIR /source
ADD --checksum=sha256:310a475de6eeb1d3e43a4df0ada0091a042487afb2a749e18c5c2d8c9aedd80f https://codeload.github.com/drakkan/sftpgo/tar.gz/62ae9ba3957e9ed52b44a4f885e805e2d7b35972 /tmp/source.tar.gz
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 -C /source
COPY storage/portable.patch /tmp/portable.patch
RUN git apply /tmp/portable.patch
COPY storage/extensions/ /source/internal/httpd/
COPY storage/overlay/ /source/
ENV GOFLAGS=-mod=readonly
COPY tests/recycle_linux_test.go /tmp/recycle_linux_test.go
RUN cp internal/httpd/nas_recycle_linux.go /tmp/nas_recycle_linux.go && go test /tmp/nas_recycle_linux.go /tmp/recycle_linux_test.go
RUN go test internal/httpd/nas_registration_policy.go internal/httpd/nas_registration_test.go
RUN go test internal/httpd/nas_archive.go internal/httpd/nas_archive_cache.go internal/httpd/nas_archive_test.go internal/httpd/nas_archive_cache_test.go
RUN go build -trimpath -ldflags "-s -w" -o /tmp/sftpgo .

FROM drakkan/sftpgo:v2.7.6
RUN mkdir -p /tmp/air-cloud-archives-v1 && chmod 700 /tmp/air-cloud-archives-v1
COPY --from=builder /tmp/sftpgo /usr/local/bin/sftpgo
COPY --from=builder /source/templates /usr/share/sftpgo/templates
COPY --from=builder /source/static /usr/share/sftpgo/static
COPY storage/entrypoint.sh /usr/local/bin/browsernas-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/browsernas-entrypoint.sh"]
CMD ["sftpgo", "serve"]
