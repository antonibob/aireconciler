#!/usr/bin/env bash
# Switch the current shell between harness profiles.
#
#   source model-harness/profiles/activate.sh deepseek
#   claude "..."            # now runs on DeepSeek, same skills, same tools
#   source model-harness/profiles/activate.sh claude
#
# Only environment variables change. The install, the .claude directory, the
# skills and CLAUDE.md are identical across profiles -- which is the point.

_profile="${1:-}"
_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$_profile" ] || [ ! -f "$_dir/$_profile.env" ]; then
    echo "usage: source activate.sh <profile>" >&2
    echo "available: $(cd "$_dir" && ls *.env | sed 's/\.env$//' | tr '\n' ' ')" >&2
    return 1 2>/dev/null || exit 1
fi

# shellcheck disable=SC1090
. "$_dir/$_profile.env"

echo "harness profile: ${HARNESS_PROFILE}"
echo "  base url : ${ANTHROPIC_BASE_URL:-<anthropic default>}"
echo "  opus  -> : ${ANTHROPIC_DEFAULT_OPUS_MODEL:-<default>}"
echo "  haiku -> : ${ANTHROPIC_DEFAULT_HAIKU_MODEL:-<default>}"
unset _profile _dir
