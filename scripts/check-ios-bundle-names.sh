#!/bin/sh
# Fails when a built iOS app bundle still names the upstream product.
#
#   scripts/check-ios-bundle-names.sh path/to/Sagax.app
#
# Scans every Mach-O binary (via `strings`), every property list (converted
# to XML), and every .strings / .xcstrings / .loctable / .json file in the
# bundle, its app extensions included, for "openmaus" in any case.
#
# Allowed: the wire identifiers the server protocol still requires, which a
# person never sees. Keep this list short and documented in ios/README.md
# ("Legacy wire identifiers").
#   _openmausbot._tcp                       Bonjour service type the desktop advertises
#   /.well-known/openmausbot/environment    environment probe older servers answer
#   openmausbot-phone-credential-v1         phone credential encryption label (#63)
#   OpenMausBot phone credential v1         HKDF info of the same credential
#   openmausbot (alone)                     the health body's `app` value
# Third-party license texts (paths containing LICENSE or Licenses) are skipped.
set -eu

app="${1:?usage: $0 path/to/App.app}"
[ -d "$app" ] || { echo "not a bundle: $app" >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
report="$tmp/report"
: > "$report"

scan() { # $1 = file label, stdin = text
  sed -e 's#_openmausbot\._tcp##g' \
      -e 's#/\.well-known/openmausbot/environment##g' \
      -e 's#openmausbot-phone-credential-v1##g' \
      -e 's#OpenMausBot phone credential v1##g' \
      -e 's#^openmausbot$##' |
    grep -i -n 'openmaus' | sed "s#^#$1: #" >> "$report" || true
}

find "$app" -type f | while IFS= read -r file; do
  case "$file" in
    *LICENSE*|*License*|*Licenses/*) continue ;;
  esac
  rel="${file#"$app"/}"
  case "$rel" in *[Oo][Pp][Ee][Nn][Mm][Aa][Uu][Ss]*) echo "$rel: file name" >> "$report" ;; esac
  case "$file" in
    *.plist)
      plutil -convert xml1 -o - "$file" 2>/dev/null | scan "$rel" ;;
    *.strings|*.stringsdict|*.xcstrings|*.loctable|*.json)
      { plutil -convert xml1 -o - "$file" 2>/dev/null || cat "$file"; } | scan "$rel" ;;
    *)
      if file -b "$file" | grep -q 'Mach-O'; then
        strings -a "$file" | scan "$rel"
      fi ;;
  esac
done

if [ -s "$report" ]; then
  echo "Upstream name found in $app:" >&2
  head -50 "$report" >&2
  exit 1
fi
echo "OK: no upstream name in $app"
