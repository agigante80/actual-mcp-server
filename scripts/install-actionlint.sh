#!/usr/bin/env bash
# install-actionlint.sh
#
# #328: install actionlint WITHOUT executing an unverified downloaded script.
#
# What was here before:
#
#   curl -fsSL .../v1.7.12/scripts/download-actionlint.bash | bash -s 1.7.12
#
# That is better than a third-party action and it IS version-pinned, but it has
# two holes that only show up when you read the installer:
#
#  1. The upstream installer performs NO verification of its own. Verified at
#     v1.7.12 (4059 bytes): zero lines matching sha256/checksum/gpg/verify, and
#     its payload is `curl -L "${url}" | tar xvz -C "$target_dir" actionlint`.
#     It pipes the release tarball straight into tar. So pinning the SCRIPT by
#     commit sha would pin nothing about the BINARY, and any binary check bolted
#     on afterwards would run AFTER untrusted bytes had already reached tar.
#  2. Git tags are mutable. `v1.7.12` can be force-moved, changing what that URL
#     serves with no diff on our side.
#
# So we skip the installer entirely. Its only real job is OS/arch detection, and
# the runner is ubuntu-latest, so that buys nothing. Two moving parts instead of
# four, and no verify-after-extract ordering bug.
#
# GitHub release assets are MUTABLE: an owner, or anyone with a stolen token, can
# delete and re-upload at the same URL. The committed digest below is therefore
# the whole control, not a belt-and-braces addition.
#
# The digest was cross-checked ONCE, by hand, against upstream's published
# actionlint_1.7.12_checksums.txt at the time it was committed. It is NEVER
# fetched at run time: that file is served from the same origin as the tarball,
# so verifying against it at runtime would be a step that reads as verification
# while verifying nothing.
#
# To bump: change VERSION and SHA256 together. A drift invariant in
# tests/unit/workflow_release_guards.test.js pins them as one declared set, so
# editing one without the other fails rather than silently trusting whatever the
# new URL serves.

set -euo pipefail

VERSION="1.7.12"
SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
ASSET="actionlint_${VERSION}_linux_amd64.tar.gz"
URL="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${ASSET}"

# Fail closed on any runner whose arch does not match the committed digest,
# rather than silently verifying the wrong artifact.
arch="$(uname -m)"
os="$(uname -s)"
if [ "${os}" != "Linux" ] || { [ "${arch}" != "x86_64" ] && [ "${arch}" != "amd64" ]; }; then
  echo "::error::install-actionlint: committed digest is for linux/amd64, refusing to run on ${os}/${arch}"
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

echo "Downloading ${ASSET}"
curl -fsSL --retry 3 --retry-delay 5 -o "${tmp}/${ASSET}" "${URL}"

# Verify BEFORE extracting. This ordering is the point: piping into tar first
# and checking afterwards would already have run the archive through a parser.
echo "${SHA256}  ${tmp}/${ASSET}" | sha256sum -c -
echo "Digest verified against the committed value."

tar xzf "${tmp}/${ASSET}" -C "${tmp}" actionlint
install -m 0755 "${tmp}/actionlint" ./actionlint

./actionlint --version
