#!/bin/sh
# Copyright (C) 2026 Perseo Mazzoni
# SPDX-License-Identifier: AGPL-3.0-or-later
# Free software under the GNU Affero General Public License, version 3 or
# later; the full text is in `LICENSE`.

# Builds the release archives of once-dark-studio-desktop into desktop/dist/:
# the desktop program and, beside it, the identity service it runs.
#
#     sh desktop/build.sh
#
# The version is the one in web/package.json, which the SPA build reads
# too; VERSION overrides it.
#
# Needs Go and a built SPA in web/dist (SPA_DIR overrides the path). The SPA
# is copied into internal/adapters/web/webdist for the embed and the
# tracked placeholder index.html is put back on exit, whether the build
# succeeds or not, so the working tree is left as it was. The Windows
# program is linked without a console window and with the icon and manifest
# `tools/winres` writes from web/public/icon-512.png; that object is
# removed on exit too.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
VERSION=${VERSION:-$(sed -n 's/^ *"version" *: *"\([^"]*\)".*/\1/p' "$ROOT/web/package.json" | head -n 1)}
VERSION=${VERSION:?web/package.json names no version}
# The product name every user-facing string carries; `product.json` is its
# only source.
PRODUCT=$(sed -n 's/.*"name" *: *"\([^"]*\)".*/\1/p' "$ROOT/product.json")
PRODUCT=${PRODUCT:?product.json names no product}
SPA=${SPA_DIR:-$ROOT/web/dist}
EMBED=$HERE/internal/adapters/web/webdist
DIST=$HERE/dist
SYSO=$HERE/cmd/once-dark-studio-desktop/rsrc_windows_amd64.syso
TARGETS="windows/amd64 darwin/arm64 darwin/amd64 linux/amd64 linux/arm64"

if [ ! -f "$SPA/index.html" ]; then
  echo "build.sh: no built SPA at $SPA; run 'npm run build' in web/ first" >&2
  exit 1
fi
# The licenses of the bundled components require their texts to travel with
# every copy, and the desktop program serves them from the SPA.
if [ ! -f "$SPA/third-party-notices.txt" ]; then
  echo "build.sh: no third-party notices in $SPA; run 'npm run notices' first" >&2
  exit 1
fi

PLACEHOLDER=$(mktemp)
cp "$EMBED/index.html" "$PLACEHOLDER"
restore() {
  rm -rf "$EMBED"
  mkdir -p "$EMBED"
  cp "$PLACEHOLDER" "$EMBED/index.html"
  rm -f "$PLACEHOLDER" "$SYSO"
}
trap restore EXIT
trap 'exit 1' INT TERM

rm -rf "$EMBED"
mkdir -p "$EMBED"
cp -R "$SPA"/. "$EMBED"/

rm -rf "$DIST"
mkdir -p "$DIST"

cd "$HERE"
go run ./tools/winres -icon "$ROOT/web/public/icon-512.png" -o "$SYSO"
for target in $TARGETS; do
  os=${target%/*}
  arch=${target#*/}
  name=once-dark-studio-desktop-$VERSION-$os-$arch
  stage=$DIST/$name
  exe=once-dark-studio-desktop
  identity=identity
  archive=$DIST/$name.tar.gz
  gui=
  if [ "$os" = windows ]; then
    gui="-H windowsgui"
    exe=once-dark-studio-desktop.exe
    identity=identity.exe
    archive=$DIST/$name.zip
  fi
  mkdir -p "$stage"
  echo "build.sh: $os/$arch"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath \
    -ldflags "-s -w $gui -X main.version=$VERSION -X 'main.productName=$PRODUCT'" \
    -o "$stage/$exe" ./cmd/once-dark-studio-desktop
  (cd "$ROOT/identity" && CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath \
    -ldflags "-s -w -X main.version=$VERSION -X 'main.productName=$PRODUCT'" \
    -o "$stage/$identity" ./cmd/identity)
  sed -e "s/@VERSION@/$VERSION/g" -e "s/@PRODUCT@/$PRODUCT/g" "$HERE/packaging/README.txt" > "$stage/README.txt"
  cp "$ROOT/LICENSE" "$stage/LICENSE"
  go run ./tools/pack -o "$archive" "$stage"
  rm -rf "$stage"
done

echo "build.sh: archives in $DIST"
ls -l "$DIST"
