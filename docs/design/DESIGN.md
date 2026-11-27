# Hearthside Design DNA (`DESIGN.md`)

Extracted from the **Hearthside Sudoku** Stitch project (`projects/10995250572349440139`, _"Paper & Terracotta Sudoku - Design System"_, Mobile `390×884` & Desktop `1280×1024`) and adapted to Hearthside's offline-first dual-theme token system in [tokens.css](../../packages/ui/src/tokens.css).

> **Stack & Offline Constraints:** Hearthside uses React + Vite + semantic CSS custom properties (`packages/ui`). It does **not** use Tailwind CSS or external font/icon CDNs at runtime; all typography and SVG iconography are bundled locally for 100% offline, kid-safe play.

---

## 1. Visual Philosophy

- **Board as the Undisputed Hero:** A tactile, warm-paper editorial interface inspired by fine stationery and logic magazines. The 9×9 Sudoku board commands visual priority inside a strict `100dvh` zero-scroll viewport.
- **Unboxed Quiet Controls:** Instead of heavy nested bordered cards around every action button, controls sit directly on quiet tonal paper/slate containers with crisp `100ms ease-out` interactive transitions.
- **Zero Layout Shift:** No conditional banners above the board. Active tool states (such as **Auto-Show Candidates**) live on the button pill itself + subtle candidate styling, while transient Check Board messages (and upcoming Run 4 Hints) render inside a permanent `32px` status rail below the board.

---

## 2. Color System & Dual-Theme Mapping

Every color in the UI is consumed exclusively through semantic `--hs-*` tokens in [tokens.css](../../packages/ui/src/tokens.css) (zero hardcoded hex values in components). Contrast meets **WCAG 2.1 AA** across all four theme×mode variants.

### Extracted Stitch Reference ("Paper & Terracotta" → Warm Hearthside)

| Role                         | Light Mode            | Dark Mode             | Usage in Hearthside                                                                                     |
| ---------------------------- | --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| Background Ground            | `#FAF7F2`             | `#1C1917`             | Shell canvas (`--hs-bg`)                                                                                |
| Board Surface                | `#FFFFFF`             | `#24201D`             | Empty / default cell fill (`--hs-cell-bg`)                                                              |
| Tonal Tile / Pill Surface    | `#F5F0E8` / `#EFE8DC` | `#2A2521` / `#352F2A` | Action tiles, digit keys, HUD chips (`--hs-surface-tile`, `--hs-surface-elevated`)                      |
| Peer Highlight (Row/Col/Box) | `#F1EAE0`             | `#312B26`             | Active row, column, and 3×3 peer highlight (`--hs-cell-peer-bg`)                                        |
| Same-Digit Highlight         | `#E8DFD1`             | `#3F362E`             | Matching digit cells (`--hs-cell-same-digit-bg`)                                                        |
| Primary Terracotta Accent    | `#B84A27`             | `#F29D80`             | Active borders, primary actions, focus (`--hs-accent`)                                                  |
| Selected Cell Tint           | `#FCEBE4`             | `#5A2717`             | Active cell tint + inner terracotta ring (`--hs-cell-selected-bg`)                                      |
| Auto-Show Active Pill        | `#F9E2D9` / `#5C1E0A` | `#8C3316` / `#FCEBE4` | Auto-Show pill background & text (`--hs-autoshow-bg`, `--hs-autoshow-text`)                             |
| Given Digit Ink              | `#24211E`             | `#F5F0E8`             | Bold immutable puzzle clues (`--hs-cell-given-text`)                                                    |
| Player-Entered Digit Ink     | `#1F5E73`             | `#8CC8DB`             | Distinct muted slate-teal player entries (`--hs-cell-entry-text`)                                       |
| Candidate Note Ink           | `#655E57`             | `#C9BFB4`             | Manual notes (`--hs-cell-notes-text`); Auto-Show shifts to slate-teal (`--hs-cell-autoshow-notes-text`) |
| Grid Hairline / Box Divider  | `#D5CBBD` / `#38332E` | `#4A423B` / `#E8DFD1` | Thin 1–8 interior lines & bold 3×3 box lines (`--hs-grid-line`, `--hs-grid-box-line`)                   |

### Clean Minimal Mapping (Cool Slate & Cobalt)

Clean Minimal applies the exact same tonal elevation structure, flat tile surfaces, zero-box button rhythm, and given-vs-player ink contrast using crisp cool slate grounds (`#F8FAFC` / `#0B1120`), cobalt primary accents (`#1D4ED8` / `#60A5FA`), and sky-toned Auto-Show pills (`#E0F2FE` / `#0C4A6E`).

### Non-Color Mistake Cues (D21)

- **Duplicate Conflict** (row/col/box duplicate): crimson container tint + border + `!` corner mark.
- **Wrong Value** (Check Board / kid-friendly live check): plum/violet tint + border + wavy underline + `×` corner mark.

---

## 3. Typography Scale & Offline Font Stack

| Token Role                 | Stitch Reference                                               | Hearthside Mapping                                                                                          | Notes                                                                             |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Display Digit (Desktop)    | `Instrument Sans`, `36px / 40px`, 700, `-0.5px`                | `--hs-font-digits` (`Plus Jakarta Sans Variable`), `clamp(1rem, 5.8cqi, 2.25rem)`                           | Container-query scaled with `tabular-nums`                                        |
| Display Digit (Mobile Key) | `Instrument Sans`, `28px / 32px`, 700, `-0.25px`               | `--hs-font-digits`, `clamp(1.25rem, 4.5vw, 1.85rem)`                                                        | Always fits 9-wide key strip without wrapping                                     |
| Headline / Title           | `Instrument Sans`, `24px` / `18px`, 600                        | `--hs-font-heading` (`Fraunces Variable` in Warm Hearthside, `Plus Jakarta Sans Variable` in Clean Minimal) | Used in modals, overlays, and shell header                                        |
| Body / Status Rail         | `Alata`, `14px / 20px`, 400                                    | `--hs-font-sans`, `0.875rem`                                                                                | Single-line truncated status rail                                                 |
| Action Label               | `Instrument Sans` / `Alata`, `13px` (desktop), `11px` (mobile) | `--hs-font-sans`, `0.8125rem` / `0.6875rem`                                                                 | Crisp Title Case (`Undo`, `Redo`, `Erase`, `Notes`, `Auto-Show`, `Check`, `Hint`) |
| Candidate Note             | `Instrument Sans`, `9px–11px`, 600                             | `--hs-font-digits`, `clamp(0.52rem, 2.15cqi, 0.78rem)`                                                      | 3×3 mini-grid centered inside empty cells                                         |
| Timer (`mono-timer`)       | `Source Code Pro`, `15px / 20px`, 600, `+0.5px`                | `--hs-font-mono`, `font-variant-numeric: tabular-nums`                                                      | Zero jitter during 1s ticks                                                       |

---

## 4. Spacing, Radii, Elevation & Motion

- **Spacing Grid (4px base):** `--hs-space-1` (`4px`), `--hs-space-2` (`8px`), `--hs-space-3` (`12px`), `--hs-space-4` (`16px`), `--hs-space-5` (`24px`), `--hs-space-6` (`32px`).
- **Shapes & Radii:**
  - `--hs-radius-sm`: `4px` (Clean Minimal) / `8px` (Warm Hearthside)
  - `--hs-radius-md`: `8px` (controls, digit keys) / `14px` (cards/modals in Warm Hearthside)
  - `--hs-radius-board`: `10px` (`0.625rem`) outer frame on the 9×9 board in Warm Hearthside, `6px` (`0.375rem`) in Clean Minimal
  - `--hs-radius-pill`: `9999px` for difficulty chips and the active Auto-Show pill
- **Elevation:** Flat paper-printed hierarchy (`--hs-shadow-board` kept soft and subtle) relying on tonal container separation (`--hs-surface` vs. `--hs-surface-tile` vs. `--hs-surface-elevated`) rather than heavy borders.
- **Motion:**
  - `--hs-motion-fast`: `100ms ease-out` for cell highlight and button state changes
  - `--hs-motion-normal`: `200ms cubic-bezier(0.2, 0, 0, 1)` for surface/theme transitions
  - Reduced to `0ms` automatically under `@media (prefers-reduced-motion: reduce)`.

---

## 5. Responsive Layout & Viewport Lock Proportions

All active Sudoku views lock to `height: 100dvh; overflow: hidden;` so the player never scrolls during play:

1. **Phone Landscape Guard (`orientation: landscape` and `max-height: 540px`):**
   - Displays a centered `"Rotate to portrait to play"` overlay instead of compressing the grid into an unplayable horizontal strip.
2. **Phone Portrait (`< 600px` wide):**
   - Slim single-row HUD -> maximum-fit square board sized dynamically via `min(100%, calc(100dvh - 280px), 460px)` -> permanent `32px` status rail -> single horizontal 7-button action strip (`min-height: 48px`) -> single horizontal `1–9` digit strip (`min-height: 52px`).
3. **Tablet Portrait (`600px–959px` wide):**
   - Centered vertical stack capped at `640px` max width; square board dynamically fitted (`min(100%, 640px, calc(100dvh - 320px))`) with generous `>= 52px` touch and stylus (S Pen) targets.
4. **Tablet Landscape & Desktop / 4K (`>= 960px` wide and `>= 541px` tall):**
   - Side-by-side workspace centered inside `max-width: 1120px`: hero square board + `32px` status rail on the left (`min(100%, 640px, calc(100dvh - 196px))`), paired with a `328px` right control panel containing the **3×3 calculator digit pad** on top and the **2-column action tile grid** (with `Hint` spanning both columns) underneath.
   - Subtle keyboard shortcut caps (`Ctrl+Z`, `Ctrl+Y`, `Del`, `N`, `A`) appear exclusively on hover/fine-pointer desktop devices (`@media (hover: hover) and (pointer: fine)`).
