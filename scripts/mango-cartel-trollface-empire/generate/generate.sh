#!/usr/bin/env bash
# generate.sh — Mango Empire: full automated image + video generation
# Uses Higgsfield CLI to produce all 12 scenes in sequence.
#
# Usage:
#   ./generate.sh              — run all scenes
#   ./generate.sh s01 s05      — run specific scenes only
#   ./generate.sh --images-only — generate images only, skip video
#   ./generate.sh --videos-only — run video generation on existing images
#   ./generate.sh --reset       — clear state and start fresh

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
SCENES_FILE="$(dirname "$0")/scenes.json"
OUTPUT_DIR="$(dirname "$0")/../../../output/mango-empire"
STATE_FILE="$OUTPUT_DIR/.state.json"
LOG_FILE="$OUTPUT_DIR/generate.log"

IMAGE_MODEL=$(jq -r '.image_model' "$SCENES_FILE")
VIDEO_MODEL=$(jq -r '.video_model' "$SCENES_FILE")
IMAGE_ASPECT=$(jq -r '.image_aspect_ratio' "$SCENES_FILE")
IMAGE_RES=$(jq -r '.image_resolution' "$SCENES_FILE")
VIDEO_DURATION=$(jq -r '.video_duration' "$SCENES_FILE")
VIDEO_MODE=$(jq -r '.video_mode' "$SCENES_FILE")
STYLE_SUFFIX=$(jq -r '.style_suffix' "$SCENES_FILE")
NEGATIVE=$(jq -r '.negative' "$SCENES_FILE")

# ── Flags ───────────────────────────────────────────────────────────────────
IMAGES_ONLY=false
VIDEOS_ONLY=false
RESET=false
SPECIFIC_SCENES=()

for arg in "$@"; do
  case "$arg" in
    --images-only) IMAGES_ONLY=true ;;
    --videos-only) VIDEOS_ONLY=true ;;
    --reset)       RESET=true ;;
    s[0-9][0-9])   SPECIFIC_SCENES+=("$arg") ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET_C='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${RESET_C} $*" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${RESET_C} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${RESET_C} $*" | tee -a "$LOG_FILE"; }
fail() { echo -e "${RED}[$(date +%H:%M:%S)] ✗${RESET_C} $*" | tee -a "$LOG_FILE"; }

# ── Setup ───────────────────────────────────────────────────────────────────
check_deps() {
  local missing=()
  command -v higgsfield &>/dev/null || missing+=("higgsfield")
  command -v jq          &>/dev/null || missing+=("jq")
  command -v curl        &>/dev/null || missing+=("curl")

  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "Missing required tools: ${missing[*]}"
    echo ""
    echo "  Install Higgsfield CLI:"
    echo "    npm install -g @higgsfield/cli"
    echo "    # or: curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh"
    echo ""
    echo "  Install jq:"
    echo "    brew install jq  /  apt install jq  /  choco install jq"
    exit 1
  fi
}

setup_dirs() {
  mkdir -p "$OUTPUT_DIR/images"
  mkdir -p "$OUTPUT_DIR/videos"
  mkdir -p "$OUTPUT_DIR/parts/part1"
  mkdir -p "$OUTPUT_DIR/parts/part2"
  mkdir -p "$OUTPUT_DIR/parts/part3"
  touch "$LOG_FILE"
}

# ── State management (resume support) ───────────────────────────────────────
state_get() {
  local scene_id="$1" field="$2"
  if [[ -f "$STATE_FILE" ]]; then
    jq -r --arg id "$scene_id" --arg f "$field" \
      '.[$id][$f] // empty' "$STATE_FILE" 2>/dev/null || true
  fi
}

state_set() {
  local scene_id="$1" field="$2" value="$3"
  local tmp
  tmp=$(mktemp)
  if [[ -f "$STATE_FILE" ]]; then
    jq --arg id "$scene_id" --arg f "$field" --arg v "$value" \
      '.[$id][$f] = $v' "$STATE_FILE" > "$tmp"
  else
    jq -n --arg id "$scene_id" --arg f "$field" --arg v "$value" \
      '{($id): {($f): $v}}' > "$tmp"
  fi
  mv "$tmp" "$STATE_FILE"
}

# Extract a direct download URL from a Higgsfield JSON result.
# The CLI returns URLs in .result.url or .url depending on the job type.
extract_url() {
  local json="$1"
  echo "$json" | jq -r '
    .result.url? // .url? // .result.video_url? // .result.image_url? // empty
  ' | head -1
}

# ── Core generation functions ────────────────────────────────────────────────
generate_image() {
  local scene_id="$1" title="$2" image_prompt="$3"

  local image_path="$OUTPUT_DIR/images/${scene_id}.jpg"
  local cached_url
  cached_url=$(state_get "$scene_id" "image_url")

  # Check if we already have the image on disk
  if [[ -f "$image_path" && -s "$image_path" ]]; then
    ok "Scene $scene_id image already exists — skipping generation"
    echo "$image_path"
    return 0
  fi

  # If we have a cached URL but no file, just re-download
  if [[ -n "$cached_url" ]]; then
    warn "Scene $scene_id image URL cached but file missing — re-downloading"
    download_file "$cached_url" "$image_path"
    echo "$image_path"
    return 0
  fi

  log "Generating image for $scene_id: $title"

  local full_prompt="${image_prompt} ${STYLE_SUFFIX}"
  local result_json

  result_json=$(higgsfield generate create "$IMAGE_MODEL" \
    --prompt "$full_prompt" \
    --negative-prompt "$NEGATIVE" \
    --aspect_ratio "$IMAGE_ASPECT" \
    --resolution "$IMAGE_RES" \
    --wait \
    --json 2>&1) || {
      fail "Image generation failed for $scene_id"
      echo "$result_json" | tail -5
      return 1
    }

  local url
  url=$(extract_url "$result_json")

  if [[ -z "$url" ]]; then
    fail "Could not extract image URL from response for $scene_id"
    echo "Raw response: $result_json" | head -20
    return 1
  fi

  state_set "$scene_id" "image_url" "$url"
  download_file "$url" "$image_path"

  ok "Scene $scene_id image saved → images/${scene_id}.jpg"
  echo "$image_path"
}

generate_video() {
  local scene_id="$1" title="$2" video_prompt="$3" image_path="$4" part="$5"

  local video_filename="${scene_id}.mp4"
  local video_path="$OUTPUT_DIR/videos/$video_filename"
  local part_path="$OUTPUT_DIR/parts/part${part}/$video_filename"
  local cached_url
  cached_url=$(state_get "$scene_id" "video_url")

  if [[ -f "$video_path" && -s "$video_path" ]]; then
    ok "Scene $scene_id video already exists — skipping generation"
    # Ensure the part symlink exists
    [[ -f "$part_path" ]] || cp "$video_path" "$part_path"
    return 0
  fi

  if [[ -n "$cached_url" ]]; then
    warn "Scene $scene_id video URL cached but file missing — re-downloading"
    download_file "$cached_url" "$video_path"
    cp "$video_path" "$part_path"
    return 0
  fi

  if [[ ! -f "$image_path" ]]; then
    fail "Cannot generate video for $scene_id — no source image at $image_path"
    return 1
  fi

  log "Generating video for $scene_id: $title"

  local result_json
  result_json=$(higgsfield generate create "$VIDEO_MODEL" \
    --prompt "$video_prompt" \
    --start-image "$image_path" \
    --duration "$VIDEO_DURATION" \
    --mode "$VIDEO_MODE" \
    --sound off \
    --wait \
    --json 2>&1) || {
      fail "Video generation failed for $scene_id"
      echo "$result_json" | tail -5
      return 1
    }

  local url
  url=$(extract_url "$result_json")

  if [[ -z "$url" ]]; then
    fail "Could not extract video URL from response for $scene_id"
    echo "Raw response: $result_json" | head -20
    return 1
  fi

  state_set "$scene_id" "video_url" "$url"
  download_file "$url" "$video_path"
  cp "$video_path" "$part_path"

  ok "Scene $scene_id video saved → videos/${scene_id}.mp4 + parts/part${part}/"
}

download_file() {
  local url="$1" dest="$2"
  log "Downloading → $(basename "$dest")"
  curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url" || {
    fail "Download failed: $url"
    return 1
  }
}

# ── Progress summary ─────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET_C}"
  echo -e "${BOLD} Generation Summary${RESET_C}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET_C}"

  local total_scenes
  total_scenes=$(jq '.scenes | length' "$SCENES_FILE")
  local images_done=0 videos_done=0

  while IFS= read -r scene_id; do
    local img="$OUTPUT_DIR/images/${scene_id}.jpg"
    local vid="$OUTPUT_DIR/videos/${scene_id}.mp4"
    local img_status vid_status
    [[ -f "$img" && -s "$img" ]] && { img_status="${GREEN}✓${RESET_C}"; ((images_done++)); } || img_status="${RED}✗${RESET_C}"
    [[ -f "$vid" && -s "$vid" ]] && { vid_status="${GREEN}✓${RESET_C}"; ((videos_done++)); } || vid_status="${RED}✗${RESET_C}"
    echo -e " $scene_id  image: $img_status  video: $vid_status"
  done < <(jq -r '.scenes[].id' "$SCENES_FILE")

  echo ""
  echo -e " Images: ${images_done}/${total_scenes}   Videos: ${videos_done}/${total_scenes}"
  echo -e " Output directory: ${CYAN}$OUTPUT_DIR${RESET_C}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET_C}"
  echo ""
}

# ── Estimate credit cost ─────────────────────────────────────────────────────
estimate_credits() {
  local total_scenes
  total_scenes=$(jq '.scenes | length' "$SCENES_FILE")
  echo ""
  echo -e "${BOLD}Credit estimate (rough):${RESET_C}"
  echo "  Image generation ($IMAGE_MODEL, $IMAGE_RES, ×${total_scenes}): ~$(( total_scenes * 8 ))–$(( total_scenes * 15 )) credits"
  echo "  Video generation ($VIDEO_MODEL, ${VIDEO_DURATION}s, ×${total_scenes}): ~$(( total_scenes * 15 ))–$(( total_scenes * 30 )) credits"
  echo "  Total: ~$(( total_scenes * 23 ))–$(( total_scenes * 45 )) credits"
  echo ""
  echo "  Run: higgsfield account  — to check your balance before starting."
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  check_deps
  setup_dirs

  if [[ "$RESET" == true ]]; then
    warn "Resetting state file..."
    rm -f "$STATE_FILE"
    ok "State cleared. All scenes will regenerate."
  fi

  echo ""
  echo -e "${BOLD}🥭  MANGO EMPIRE — Automated Generation${RESET_C}"
  echo -e "    Series: $(jq -r '.series' "$SCENES_FILE")"
  echo -e "    Image model: $IMAGE_MODEL  |  Video model: $VIDEO_MODEL"
  echo -e "    Output: $OUTPUT_DIR"
  echo ""

  estimate_credits

  # Check auth
  log "Checking Higgsfield authentication..."
  if ! higgsfield account &>/dev/null; then
    warn "Not authenticated — launching login..."
    higgsfield auth login
  fi

  # Build list of scenes to process
  local scene_ids=()
  if [[ ${#SPECIFIC_SCENES[@]} -gt 0 ]]; then
    scene_ids=("${SPECIFIC_SCENES[@]}")
    log "Running specific scenes: ${scene_ids[*]}"
  else
    while IFS= read -r id; do
      scene_ids+=("$id")
    done < <(jq -r '.scenes[].id' "$SCENES_FILE")
    log "Running all ${#scene_ids[@]} scenes"
  fi

  local errors=0

  for scene_id in "${scene_ids[@]}"; do
    local scene_json
    scene_json=$(jq --arg id "$scene_id" '.scenes[] | select(.id == $id)' "$SCENES_FILE")

    if [[ -z "$scene_json" ]]; then
      fail "Scene $scene_id not found in scenes.json"
      continue
    fi

    local title part image_prompt video_prompt
    title=$(echo "$scene_json"         | jq -r '.title')
    part=$(echo "$scene_json"          | jq -r '.part')
    image_prompt=$(echo "$scene_json"  | jq -r '.image_prompt')
    video_prompt=$(echo "$scene_json"  | jq -r '.video_prompt')

    echo ""
    echo -e "${BOLD}── Scene $scene_id · Part $part · $title ──────────────────${RESET_C}"

    # Step 1: generate image
    local image_path=""
    if [[ "$VIDEOS_ONLY" == false ]]; then
      image_path=$(generate_image "$scene_id" "$title" "$image_prompt") || {
        fail "Skipping video for $scene_id due to image failure"
        ((errors++))
        continue
      }
    else
      image_path="$OUTPUT_DIR/images/${scene_id}.jpg"
    fi

    # Step 2: generate video from image
    if [[ "$IMAGES_ONLY" == false ]]; then
      generate_video "$scene_id" "$title" "$video_prompt" "$image_path" "$part" || {
        fail "Video generation failed for $scene_id — continuing to next scene"
        ((errors++))
      }
    fi
  done

  print_summary

  if [[ $errors -gt 0 ]]; then
    warn "$errors scene(s) encountered errors. Re-run the script to retry — completed scenes are skipped automatically."
    exit 1
  else
    ok "All scenes complete. Import the videos from output/mango-empire/parts/ into CapCut."
  fi
}

main "$@"
