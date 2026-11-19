#!/bin/sh
# Install the Ritchie compiler (ritchie, rcc and rcrun) for this machine.
#
#   curl -fsSL https://ritchie.dev/install.sh | sh
#
# RITCHIE_BIN_DIR picks the directory the commands go in (default
# ~/.local/bin). Programs need Go 1.27 or newer on PATH to build and run;
# this script checks for it but does not install it.
#
# The binaries are licensed for evaluation only; installing them accepts the
# Ritchie Evaluation Licence at https://ritchie.dev/downloads/LICENSE.txt.
#
# The whole script is one function called on the last line, so a download
# cut short runs nothing.
set -eu

main() {
  version='2026-11-19-fe7ece62'
  base=${RITCHIE_DOWNLOAD_URL:-'https://github.com/codemartial/ritchie.dev/releases/download/ritchie-2026-11-19-fe7ece62'}
  bindir=${RITCHIE_BIN_DIR:-$HOME/.local/bin}
  sharedir=${RITCHIE_SHARE_DIR:-$HOME/.local/share/ritchie}

  case $(uname -s) in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "this installer supports macOS and Linux; for Windows, download the zip from https://ritchie.dev/downloads/releases/" ;;
  esac
  case $(uname -m) in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "no build for $(uname -m); see https://ritchie.dev/downloads/releases/" ;;
  esac
  # A shell running under Rosetta reports x86_64 on Apple silicon.
  if [ "$os-$arch" = darwin-amd64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi

  name=ritchie-$version-$os-$arch
  archive=$name.tar.gz
  case $os-$arch in
    darwin-arm64) expected='6164eef4c4554ce0102e9ccc90bf89b8350fb07b2b92984bc97aa71ef195ad57' ;;
    darwin-amd64) expected='51e8199c0d589e4f3a5f78871faa6afa1f40a83330dbd462b2a1acbd15f4a143' ;;
    linux-amd64) expected='52e5fcddf8ec0a933152f83fd74ee81f7ead35522432c7d5bb7646e09b0a0aae' ;;
    linux-arm64) expected='cf08ec55a6544b190d1a16285b507dbe38a730fc9747d554b36653711f54589a' ;;
    *) fail "no build for $os/$arch; see https://ritchie.dev/downloads/releases/" ;;
  esac

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM
  say "downloading $archive"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$tmp/$archive" "$base/$archive" || fail "could not download $base/$archive"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$tmp/$archive" "$base/$archive" || fail "could not download $base/$archive"
  else
    fail "curl or wget is required"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp/$archive" | cut -d' ' -f1)
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tmp/$archive" | cut -d' ' -f1)
  else
    fail "sha256sum or shasum is required to verify the download"
  fi
  [ "$actual" = "$expected" ] || fail "checksum mismatch for $archive: expected $expected, got $actual"

  tar -xzf "$tmp/$archive" -C "$tmp"
  mkdir -p "$bindir" "$sharedir"
  for command in ritchie rcc rcrun; do
    cp "$tmp/$name/bin/$command" "$tmp/$command.new"
    chmod 755 "$tmp/$command.new"
    mv -f "$tmp/$command.new" "$bindir/$command"
  done
  cp "$tmp/$name/LICENSE" "$sharedir/LICENSE"
  say "installed ritchie $version in $bindir"
  say "for evaluation only, under the Ritchie Evaluation Licence: $sharedir/LICENSE"

  case ":$PATH:" in
    *":$bindir:"*) ;;
    *) say "add $bindir to PATH, for example: export PATH=\"$bindir:\$PATH\"" ;;
  esac
  check_go
}

check_go() {
  if ! command -v go >/dev/null 2>&1; then
    say "Go 1.27 or newer is required to build and run programs and is not on PATH: https://go.dev/dl/"
    return
  fi
  gover=$(go env GOVERSION 2>/dev/null || true)
  gover=${gover#go}
  major=${gover%%.*}
  minor=${gover#*.}
  minor=${minor%%[!0-9]*}
  case $major$minor in
    '' | *[!0-9]*) say "could not read the Go version; Ritchie needs Go 1.27 or newer"; return ;;
  esac
  if [ "$major" -lt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -lt 27 ]; }; then
    say "Go $gover is on PATH; Ritchie needs Go 1.27 or newer: https://go.dev/dl/"
  fi
}

say() { printf 'ritchie-install: %s\n' "$1"; }
fail() { printf 'ritchie-install: %s\n' "$1" >&2; exit 1; }

main "$@"
