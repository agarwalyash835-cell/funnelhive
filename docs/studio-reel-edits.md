# Studio reel edits: audit, gaps and what was built (6 Nov 2026)

## Audit: what Studio did before this branch

A Reel is generated end to end: script, AI stills and clips, then a line-by-line voiceover with a listen-back check.
`reels.js` `edit()` then calls `assemble.js` `render()`. Sellers can't upload their own talking-head footage into a
Reel; that pipeline doesn't exist.

| Toolkit item | Before | Where |
|---|---|---|
| Word-by-word / karaoke captions | Yes: 5 looks (pop, lower, karaoke, minimal, matte), timed from the transcript, safe-area aware | `captions.js` |
| Keyword highlight | Only numbers and ₹ in some looks; no chosen keywords | `captions.js` |
| Indian scripts in captions | Fonts are in the Docker image, but captions use one brand font for every script, so Indic glyphs can come out as tofu | `captions.js`, `typeset.js` `fontFor` |
| Silence / filler jump cuts | No (only flagged in the voiceover check) | `voice.js` |
| Zoom punch-ins | Time-based (every N s, alternating 100/115%), not on emphasis | `assemble.js` `joinClips` |
| SFX | One whoosh type, under cuts only | `assemble.js` `mixAudio` |
| Music ducking | Yes (sidechain) | `assemble.js` `mixAudio` |
| Beat-synced cuts | No | — |
| Speed ramps | No | — |
| Transitions | dissolve / cinematic (fade, smoothleft, fadeblack) / hard cut; no whip or zoom | `assemble.js` |
| B-roll over talking head | No | — |
| Before/after split, split screen | No | — |
| Motion-graphic overlays (price tag, counter, pin, lower third, progress bar) | No (static designs only, in `typeset.js`) | — |
| CTA end card | Yes, as an image card (headline, offer, CTA) plus logo; no phone or WhatsApp line | `reels.js` `makeCard` |
| 9:16 reframe of 16:9 | Fixed upper-centre crop or blurred pad; never follows the subject | `assemble.js` `fitGraph` |
| Grade presets | natural, cinematic, matte, plus nudges | `assemble.js` `LOOKS` |
| Industry edit templates | No (`recommend.js` purposes and `standard.js` hooks/structures only) | — |

## Built on this branch

Everything below is free to the seller: it only re-runs the edit, never the paid shots.

**Captions** (`captions.js`)
- Keyword pops: numbers, ₹ and % always pop; `keywords: 'auto'` adds offer, urgency and proof words in English, Hindi and Hinglish; sellers can also pass their own list. A keyword lands bigger, and in phrase looks it stays in the highlight colour.
- Two new looks: `punch` (one big word at a time, the creator style) and `strip` (a phrase on a solid strip, calm).
- Words in an Indian script are set in their own Noto face (`\fn`), so a Latin brand font no longer shows tofu boxes.

**Cutting** (`reelfx.js`)
- `jumpCutPlan`, `remapWords` and `cutTalkingHead` remove silences and fillers (including उम्म and अं) and alternate 100% and 115% framing.
- `emphasisTimes` and `punchOnEmphasis` punch in on keywords. Reels use this when the style's `punch` is `emphasis`.

**Sound** (`reelfx.js`)
- Synthetic whoosh, riser, pop and impact sounds (`addSfx`). In a Reel, pops land on overlays and punch-ins, and a riser plus impact go into the closing card.
- Ducking was already there.
- `beatTimes` and `snapToBeats` find the music's beats. Reels with `beatSync` (and no presenter) move their cuts onto the beat.

**Motion** (`reelfx.js`, `assemble.js`)
- `speedRamp`: Reels slow the first close or macro shot mid-move.
- New transitions: whip (`hblur`), zoom (`zoomin`), mixed, and match/hard cut.
- `brollOver` for B-roll inserts, `splitScreen` and `wipeReveal` for before/after.

**Overlays and endings** (`motion.js`, one ASS file burnt in by libass)
- Price tag, counter roll-up (Indian grouping, lakh and crore), location pin, lower third, progress bar, badge, label, and a CTA panel with a phone or WhatsApp line.
- `overlaysFrom` fills these from the Reel's offer and `overlayInfo`, and leaves out any overlay whose value is missing.

**Reframe** (`reelfx.js`)
- `reframeTrack` follows the subject when cropping 16:9 footage to 9:16, using edge and motion energy.

**Grades** (`assemble.js`)
- New: `warm_luxe`, `clean_bright`, `moody`, `food_pop`.

**Industry templates** (`recipes.js`)
- 81 recipes, 2–3 for each of the 33 industries.
- Each names its hook, structure, pace, caption look, transitions, overlays, grade, music mood, SFX, beat sync, speed ramp, B-roll or split, and CTA.
- Careful industries (clinic, finance, loans, study abroad, lab) get calm CTAs and a disclaimer line.

**Where sellers reach them**
- The new-Reel form has an "Edit style" pick; the recipe steers the script writer and sets the caption look and grade.
- A finished Reel has an "Edit style" panel: switch style, see other industries' styles, set transitions, and fill in the overlays (price, location, number, deadline, phone, WhatsApp).
- `GET /api/studio/recipes`; `/api/studio` returns the seller's own industry styles.
- Hive: a new `studio_edit_styles` tool; `studio_make_reel` takes `recipe`; `studio_edit_reel` takes `recipe`, `transitions` and `overlayInfo`. The canvas and director edit path (`edit.js`) accepts the same fields.

## Still missing

- **Uploading your own footage.** Sellers can't upload their own talking-head footage into a Reel. Studio Reels are AI-generated, and the voiceover is AI speech recorded line by line. So jump cuts (`cutTalkingHead`), B-roll over a talking head (`brollOver`), split screen and before/after (`splitScreen`, `wipeReveal`) and reframing (`reframeTrack`) are built and tested as editor steps, but no seller flow calls them yet. Next step: a "your own video" Reel kind (upload, transcribe, jump-cut, then the same recipe edit).
- Recipes set `broll`/`split` as a direction for the script writer only; the render doesn't build a split from two scenes yet.
- **Server ffmpeg not checked.** The xfade names `hblur` and `zoomin` and the new `NEEDED` filters aren't verified on the production ffmpeg. Before deploying, run `ffmpeg -h filter=xfade` and the `missingFilters()` test in the container.
- **Recipes not checked against real top reels.** The research could not open Instagram or YouTube, so the recipes follow well-known patterns rather than frame-by-frame analysis.
- **Tracking and beats are heuristic.** Reframe tracking uses edges plus motion, not face detection. Beat detection only searches 70–180 BPM.
- **Not viewed by eye.** No finished Reel in a recipe style has been watched; the tests check structure, length and loudness.
