# Hearthside Asset Tool Inventory (D6)

- **Date:** 2026-11-26
- **Related:** [D6: Asset tools](../decisions/0006-asset-tools.md), [assets/manifest.json](../../assets/manifest.json)
- **Rule:** Never place an image, font, or audio file into `assets/` without recording `path`, `source`, `license`, `attribution`, `tool`, and `termsUrl` in `assets/manifest.json`.

## Asset Categories Needed

1. **Icons & UI Graphics:** App launcher icons (vector SVG + raster PNGs), game tiles, badges, and UI status glyphs.
2. **Theme Backgrounds & Illustrations:** Optional subtle paper/linen textures, celebration art, and future card game artwork.
3. **UI Sound Effects:** Soft placement taps, candidate note ticks, erase, conflict alert, and puzzle completion chimes.
4. **Background Music:** Gentle, loopable, independently mutable ambient tracks for family puzzle sessions.

## Google AI Pro Tools (Owner Verification Required)

> All Google AI Pro entries below are **Pending owner verification** until the project owner confirms account entitlement and current output licensing terms.

| Tool                                                                   | Asset Categories                                           | Confirmed Access           | Output Terms URL           | Licensing / Attribution Notes                                             | Status                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------- | -------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| Imagen / Gemini Image Generation                                       | Theme illustrations, card art, raster icon concepts        | Pending owner verification | Pending owner verification | Confirm commercial/distribution & watermark terms before external sharing | Pending owner verification |
| Veo / Flow / Media Labs (if included in tier)                          | Animated celebration assets or promotional clips (if used) | Pending owner verification | Pending owner verification | Verify static frame export terms if used                                  | Pending owner verification |
| Google AI Pro Audio / Music tools (e.g., Lyria / MusicFX, if entitled) | Background music & ambient loops                           | Pending owner verification | Pending owner verification | Confirm standalone audio export rights & attribution rules                | Pending owner verification |

## Free Ubuntu Tools

> Verify installed versions and current upstream license/output terms on the Ubuntu workstation/home server before generating release assets.

| Tool     | Asset Categories                                                | Confirmed Access           | Output Terms URL                            | Licensing / Attribution Notes                                            | Status                     |
| -------- | --------------------------------------------------------------- | -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| Inkscape | Vector SVG icons, board accents, crisp UI graphics              | Pending owner verification | https://inkscape.org/about/license/         | GPLv2+ tool; user-created SVG outputs carry user-chosen license          | Pending owner verification |
| GIMP     | Raster icon export, background textures, sprite sheets          | Pending owner verification | https://www.gimp.org/about/COPYING          | GPLv3 tool; user-created image outputs carry user-chosen license         | Pending owner verification |
| Krita    | Hand-painted illustrations and card artwork                     | Pending owner verification | https://krita.org/en/about/license/         | GPLv3 tool; user-created artwork outputs carry user-chosen license       | Pending owner verification |
| Audacity | Sound effect recording, trimming, normalization, OGG/WAV export | Pending owner verification | https://www.audacityteam.org/about/license/ | GPLv3 tool; user-created recordings/edits carry user-chosen license      | Pending owner verification |
| LMMS     | Synthesized UI chimes and loopable background music             | Pending owner verification | https://lmms.io/documentation/License       | GPLv2+ tool; verify any bundled SoundFonts/samples separately before use | Pending owner verification |
