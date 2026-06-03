#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-0.1.0}"
PACKAGE="frostbyte-control-plane"
ARCH="amd64"
STAGE_ROOT="$ROOT/dist/deb"
STAGE="$STAGE_ROOT/${PACKAGE}_${VERSION}_${ARCH}"
OUT_DEB="$STAGE_ROOT/${PACKAGE}_${VERSION}_${ARCH}.deb"

npm run build

rm -rf "$STAGE"
mkdir -p \
  "$STAGE/DEBIAN" \
  "$STAGE/opt/frostbyte-control-plane/apps/api" \
  "$STAGE/opt/frostbyte-control-plane/apps/worker" \
  "$STAGE/opt/frostbyte-control-plane/apps/web" \
  "$STAGE/opt/frostbyte-control-plane/packages/core" \
  "$STAGE/etc/frostbyte-control-plane" \
  "$STAGE/lib/systemd/system"

cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/.env.example" "$STAGE/opt/frostbyte-control-plane/"
cp "$ROOT/apps/api/package.json" "$STAGE/opt/frostbyte-control-plane/apps/api/"
cp -R "$ROOT/apps/api/dist" "$STAGE/opt/frostbyte-control-plane/apps/api/"
cp "$ROOT/apps/worker/package.json" "$STAGE/opt/frostbyte-control-plane/apps/worker/"
cp -R "$ROOT/apps/worker/dist" "$STAGE/opt/frostbyte-control-plane/apps/worker/"
cp "$ROOT/apps/web/package.json" "$STAGE/opt/frostbyte-control-plane/apps/web/"
cp -R "$ROOT/apps/web/dist" "$STAGE/opt/frostbyte-control-plane/apps/web/"
cp "$ROOT/packages/core/package.json" "$STAGE/opt/frostbyte-control-plane/packages/core/"
cp -R "$ROOT/packages/core/dist" "$STAGE/opt/frostbyte-control-plane/packages/core/"

(
  cd "$STAGE/opt/frostbyte-control-plane"
  npm ci --omit=dev --workspaces --ignore-scripts
)

cp "$ROOT/packaging/deb/env" "$STAGE/etc/frostbyte-control-plane/env"
cp "$ROOT/packaging/deb/frostbyte-api.service" "$STAGE/lib/systemd/system/"
cp "$ROOT/packaging/deb/frostbyte-worker.service" "$STAGE/lib/systemd/system/"
cp "$ROOT/packaging/deb/frostbyte-web.service" "$STAGE/lib/systemd/system/"
cp "$ROOT/packaging/deb/postinst" "$ROOT/packaging/deb/prerm" "$ROOT/packaging/deb/postrm" "$STAGE/DEBIAN/"

installed_size="$(du -sk "$STAGE" | cut -f1)"
cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: $PACKAGE
Version: $VERSION
Section: web
Priority: optional
Architecture: $ARCH
Maintainer: Frostbyte <frostbyte@local>
Depends: nodejs (>= 20), npm
Installed-Size: $installed_size
Description: Frostbyte Control Plane local AI workflow orchestrator
 Local-first Chat + Canvas AI workflow orchestrator with Ollama-first model support.
CONTROL

chmod -R u=rwX,go=rX "$STAGE"
chmod 755 "$STAGE/DEBIAN" "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm" "$STAGE/DEBIAN/postrm"
chmod 644 "$STAGE/DEBIAN/control"
dpkg-deb --build --root-owner-group "$STAGE" "$OUT_DEB"
echo "$OUT_DEB"
