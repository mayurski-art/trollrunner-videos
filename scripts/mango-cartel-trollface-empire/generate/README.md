# Mango Empire — Automated Generation

Generates all 12 scene images + video clips using the Higgsfield CLI.
Each scene runs in two steps: image → video (using the image as the starting
frame). Completed scenes are skipped on re-runs so you can resume freely.

## Setup

**1. Install Higgsfield CLI**
```bash
npm install -g @higgsfield/cli
# or
curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh
```

**2. Install jq** (for JSON parsing)
```bash
brew install jq        # macOS
apt install jq         # Ubuntu/Debian
choco install jq       # Windows
```

**3. Authenticate**
```bash
higgsfield auth login
```

**4. Check your credit balance**
```bash
higgsfield account
# Full 12-scene run costs roughly 280–540 credits
# Free tier: 150 credits/month
```

## Run

```bash
# Make executable (first time only)
chmod +x generate.sh

# Run everything — all 12 scenes
./generate.sh

# Run specific scenes only
./generate.sh s01 s05 s12

# Generate images only (no video yet)
./generate.sh --images-only

# Generate videos from existing images (after reviewing images first)
./generate.sh --videos-only

# Wipe state and start from scratch
./generate.sh --reset
```

## Output structure

```
output/mango-empire/
  images/
    s01.jpg  s02.jpg  …  s12.jpg     ← key art, one per scene
  videos/
    s01.mp4  s02.mp4  …  s12.mp4     ← raw clips, one per scene
  parts/
    part1/   s01.mp4  s02.mp4  s03.mp4  s04.mp4
    part2/   s05.mp4  s06.mp4  s07.mp4  s08.mp4
    part3/   s09.mp4  s10.mp4  s11.mp4  s12.mp4
  .state.json     ← resume state (auto-managed, don't edit)
  generate.log    ← full run log
```

Import the `parts/part1`, `parts/part2`, `parts/part3` folders directly into
CapCut. Each folder is one complete Short/TikTok video in sequence order.

## Changing models

Edit `scenes.json` at the top level:

| Field | Default | Options |
|-------|---------|---------|
| `image_model` | `nano_banana_2` | `soul_v2`, `flux_2`, `gpt_image_2`, `seedream` |
| `video_model` | `kling3_0` | `seedance_2`, `veo3_1`, `wan2_7` |
| `video_duration` | `5` | `3`–`10` (seconds) |
| `video_mode` | `pro` | `standard`, `pro` |
| `image_resolution` | `2k` | `1k`, `2k`, `4k` |

## Retrying a failed scene

The script skips any scene that already has an output file. To force a single
scene to regenerate, just delete its output files:

```bash
rm output/mango-empire/images/s05.jpg
rm output/mango-empire/videos/s05.mp4
./generate.sh s05
```

## Tips

- Run `--images-only` first and review all 12 images before committing to
  video generation. Images are cheap; video is expensive.
- If a generated image drifts from the character bible, regenerate just that
  scene before moving to video.
- Kling v3.0 (`kling3_0`) produces the best cinematic motion for this style.
  Seedance 2.0 (`seedance_2`) is faster and cheaper if credits are tight.
- After generation, bring all clips into CapCut, add the VO (ElevenLabs),
  burn in captions, layer the trending audio hit at the start of each part.
  See `dialogue-scripts.md` for exact timestamps.
