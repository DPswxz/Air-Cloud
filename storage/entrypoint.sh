#!/bin/sh
set -eu
# Run as the image's unprivileged sftpgo user; keep the key with the database.
key=/var/lib/sftpgo/browsernas-signing-key
if [ ! -s "$key" ]; then
    umask 077
    head -c 48 /dev/urandom | base64 > "$key.tmp"
    mv "$key.tmp" "$key"
fi
export SFTPGO_HTTPD__SIGNING_PASSPHRASE_FILE="$key"
exec "$@"
