# shellcheck shell=bash
# Canonical spike runtime-provenance contract. Sourced by run.sh; exercised by
# canonical-provenance.test.sh. Spike-only tooling, not production code.
#
# A canonical run must prove:
#   clean checkout -> captured HEAD -> backend freshly built from that
#   checkout -> runtime launched with BUILD_COMMIT=HEAD -> the generation
#   trace's runtime.buildCommit equals that same HEAD.
#
# Every function prints a "CANONICAL PROVENANCE FAIL: ..." line on stderr and
# returns non-zero when the contract cannot be established. Nothing here
# reads or writes the database or calls a provider.

canonical_fail() {
  echo "CANONICAL PROVENANCE FAIL: $*" >&2
  return 1
}

# The build input must be exactly HEAD: no unstaged or staged edits to tracked
# files and no untracked (non-ignored) files under be/, which the build would
# compile. Untracked files elsewhere (e.g. other spike dossiers) do not reach
# the backend build.
canonical_require_clean_checkout() {
  local repo="$1"
  git -C "$repo" rev-parse --verify -q HEAD >/dev/null ||
    { canonical_fail "no git HEAD in $repo"; return 1; }
  git -C "$repo" diff --quiet ||
    { canonical_fail "unstaged changes to tracked files"; return 1; }
  git -C "$repo" diff --cached --quiet ||
    { canonical_fail "staged but uncommitted changes"; return 1; }
  local untracked
  untracked="$(git -C "$repo" ls-files --others --exclude-standard -- be)"
  [ -z "$untracked" ] ||
    { canonical_fail "untracked files under be/: $(echo "$untracked" | head -5 | tr '\n' ' ')"; return 1; }
}

canonical_source_head() {
  git -C "$1" rev-parse HEAD
}

# Builds be/ with the repository's own build script (`yarn build`) and proves
# the runtime entry point was emitted by THIS build (newer than a marker taken
# just before it), so a stale prebuilt dist can never pass.
canonical_build_backend() {
  local repo="$1"
  local entry="$repo/be/dist/src/main.js"
  local marker
  marker="$(mktemp)" || { canonical_fail "cannot create build marker"; return 1; }
  # Filesystems with 1s mtime resolution: make "newer than marker" strict.
  sleep 1
  if ! (cd "$repo/be" && yarn build) >&2; then
    rm -f "$marker"
    canonical_fail "backend build failed"
    return 1
  fi
  if [ ! -f "$entry" ]; then
    rm -f "$marker"
    canonical_fail "build produced no $entry"
    return 1
  fi
  if [ -z "$(find "$entry" -newer "$marker")" ]; then
    rm -f "$marker"
    canonical_fail "$entry was not emitted by this build (stale dist)"
    return 1
  fi
  rm -f "$marker"
}

# Deterministic SHA-256 over every file of the built dist tree (paths +
# contents), used to prove the runtime launched is the tree just built.
canonical_dist_fingerprint() {
  local dist="$1/be/dist"
  [ -d "$dist" ] || { canonical_fail "no dist directory at $dist"; return 1; }
  (cd "$dist" && find . -type f -print0 | LC_ALL=C sort -z |
    xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
}

# Prints a dotted JSON field of a file ("" when the file or field is missing).
canonical_json_field() {
  node -e '
    const fs = require("node:fs");
    try {
      let v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      for (const k of process.argv[2].split(".")) v = v?.[k];
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch { process.stdout.write(""); }
  ' "$1" "$2"
}

# Requires runtime.buildCommit in a saved generation trace to equal the
# expected source HEAD. "unknown", empty or missing is a failure.
canonical_verify_runtime_commit() {
  local trace="$1" expected="$2"
  [ -n "$expected" ] || { canonical_fail "no expected source HEAD"; return 1; }
  [ -f "$trace" ] || { canonical_fail "no generation trace at $trace"; return 1; }
  local actual
  actual="$(canonical_json_field "$trace" runtime.buildCommit)"
  if [ -z "$actual" ] || [ "$actual" = "unknown" ]; then
    canonical_fail "trace runtime.buildCommit is '${actual:-<missing>}'"
    return 1
  fi
  [ "$actual" = "$expected" ] ||
    { canonical_fail "trace runtime.buildCommit $actual != source HEAD $expected"; return 1; }
}

# Requires the run manifest's recorded source HEAD and build commit to both
# equal the expected source HEAD.
canonical_verify_manifest_commit() {
  local manifest="$1" expected="$2"
  [ -f "$manifest" ] || { canonical_fail "no run manifest at $manifest"; return 1; }
  local head build
  head="$(canonical_json_field "$manifest" provenance.sourceHead)"
  build="$(canonical_json_field "$manifest" provenance.buildCommit)"
  [ "$head" = "$expected" ] ||
    { canonical_fail "manifest provenance.sourceHead '${head:-<missing>}' != $expected"; return 1; }
  [ "$build" = "$expected" ] ||
    { canonical_fail "manifest provenance.buildCommit '${build:-<missing>}' != $expected"; return 1; }
}
