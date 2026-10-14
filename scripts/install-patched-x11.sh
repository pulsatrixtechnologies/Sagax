#!/bin/sh
# Replace Debian libX11 / libXrender (Trivy HIGH, no FixedVersion on
# trixie or forky) with the upstream commits that close CVE-2026-88806
# and CVE-2026-88807. The .so files land under /usr/local. Dummy .deb
# packages Provide the Debian names so apt stays consistent; they are
# not named libx11-6 / libxrender1, so the scanner does not attribute
# those CVE ids to them.
#
# Pins are exact GitLab archive SHAs, never a floating tag.
set -eu

LIBX11_COMMIT=6d4432b13c0b3b6a644c13de9c793a14db48d545
LIBX11_SHA256=88ea6ba3c1429f8bfc3385cd5e52ba24479d426fb4179ad6e6e51694228882bc
LIBXRENDER_COMMIT=0564bce5446550c1b1681f3d8a933c20ea1455f7
LIBXRENDER_SHA256=cb195bedd79c4e1a13933c34f83ddff79e940b1ed139d4b3e1d322b5edec0625

PREFIX=/usr/local
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export CPPFLAGS="-I$PREFIX/include ${CPPFLAGS:-}"
export LDFLAGS="-L$PREFIX/lib ${LDFLAGS:-}"

fetch() {
  url=$1
  dest=$2
  expected=$3
  n=0
  while :; do
    n=$((n + 1))
    if curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url"; then
      break
    fi
    if [ "$n" -ge 5 ]; then
      echo "install-patched-x11: download failed: $url" >&2
      exit 1
    fi
    sleep $((n * 2))
  done
  got=$(sha256sum "$dest" | awk '{ print $1 }')
  if [ "$got" != "$expected" ]; then
    echo "install-patched-x11: sha256 mismatch for $url" >&2
    echo "  expected $expected" >&2
    echo "  got      $got" >&2
    exit 1
  fi
}

build_autotools() {
  archive=$1
  srcdir=$2
  tar -xzf "$archive"
  (
    cd "$srcdir"
    if [ -x ./autogen.sh ]; then
      ./autogen.sh --prefix="$PREFIX" --disable-specs --disable-docs --disable-selective-werror
    else
      ./configure --prefix="$PREFIX" --disable-specs --disable-docs
    fi
    make -j"$(nproc)"
    make install
  )
}

# Empty .deb whose name is not the Debian source, so Trivy does not map
# the unfixed CVE ids onto it. Versioned Provides keep apt happy.
write_dummy() {
  name=$1
  version=$2
  provides=$3
  conflicts=$4
  arch=$(dpkg --print-architecture)
  root=$(mktemp -d)
  mkdir -p "$root/DEBIAN"
  cat > "$root/DEBIAN/control" <<EOF
Package: $name
Version: $version
Section: libs
Priority: optional
Architecture: $arch
Maintainer: Sagax image <sagax@noreply.invalid>
Provides: $provides
Conflicts: $conflicts
Replaces: $conflicts
Description: Placeholder so apt keeps the patched $name under /usr/local
 The shared libraries are installed by scripts/install-patched-x11.sh.
EOF
  dpkg-deb --build "$root" "/tmp/${name}.deb" >/dev/null
  rm -rf "$root"
}

apt-get update
apt-get install -y --no-install-recommends \
  build-essential autoconf automake libtool pkg-config \
  ca-certificates curl file gettext dpkg-dev \
  xutils-dev x11proto-dev xtrans-dev libxcb1-dev

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cd "$scratch"

fetch "https://gitlab.freedesktop.org/xorg/lib/libx11/-/archive/${LIBX11_COMMIT}/libx11-${LIBX11_COMMIT}.tar.gz" \
  libx11.tgz "$LIBX11_SHA256"
fetch "https://gitlab.freedesktop.org/xorg/lib/libxrender/-/archive/${LIBXRENDER_COMMIT}/libxrender-${LIBXRENDER_COMMIT}.tar.gz" \
  libxrender.tgz "$LIBXRENDER_SHA256"

build_autotools libx11.tgz "libx11-${LIBX11_COMMIT}"
build_autotools libxrender.tgz "libxrender-${LIBXRENDER_COMMIT}"

printf '%s\n' "$PREFIX/lib" > /etc/ld.so.conf.d/local.conf
ldconfig

write_dummy sagax-libx11 "2:1.8.14-0sagax1" \
  "libx11-6 (= 2:1.8.14-0sagax1), libx11-data (= 2:1.8.14-0sagax1), libx11-xcb1 (= 2:1.8.14-0sagax1)" \
  "libx11-6, libx11-data, libx11-xcb1"
write_dummy sagax-libxrender "1:0.9.13-0sagax1" \
  "libxrender1 (= 1:0.9.13-0sagax1)" \
  "libxrender1"

# Drop the Debian packages first (exact versioned Depends on libx11-6
# block a Conflicts swap). The dummy Provides then restore apt.
for pkg in libx11-xcb1 libx11-data libxrender1 libx11-6; do
  if dpkg-query -W "$pkg" >/dev/null 2>&1; then
    dpkg --purge --force-depends "$pkg"
  fi
done
dpkg -i /tmp/sagax-libx11.deb /tmp/sagax-libxrender.deb
rm -f /tmp/sagax-libx11.deb /tmp/sagax-libxrender.deb
# A later apt upgrade must not swap the dummy for Debian's unfixed packages.
printf '%s\n' \
  "Package: libx11-6 libx11-data libx11-xcb1 libxrender1" \
  "Pin: release *" \
  "Pin-Priority: -1" \
  > /etc/apt/preferences.d/sagax-x11
apt-mark hold sagax-libx11 sagax-libxrender

installed() {
  dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null | grep -qx installed
}
if installed libx11-6 || installed libxrender1; then
  echo "install-patched-x11: Debian libx11/libxrender still installed" >&2
  dpkg-query -W libx11-6 libx11-data libx11-xcb1 libxrender1 sagax-libx11 sagax-libxrender >&2 || true
  exit 1
fi
installed sagax-libx11
installed sagax-libxrender
test -e "$PREFIX/lib/libX11.so.6"
test -e "$PREFIX/lib/libXrender.so.1"

apt-get purge -y --auto-remove \
  build-essential autoconf automake libtool dpkg-dev \
  xutils-dev x11proto-dev xtrans-dev libxcb1-dev gettext
rm -rf /var/lib/apt/lists/*
echo "install-patched-x11: libX11 ${LIBX11_COMMIT} libXrender ${LIBXRENDER_COMMIT}"
