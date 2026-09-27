# Thai / English localization report

Branch: `feat/th-en-i18n`. Local commits only; no push or pull request.

## Scope and compatibility

The six skills remain self-contained and dependency-free. UI language and content language are separate: `--lang` overrides JSON `lang`, then defaults to Chinese. `contentLang` defaults to `zh`; `th` and `en` select language-aware content checks. Authored story text is preserved when switching the UI. Model-facing image/video protocol remains English by default; existing upstream Chinese options remain compatible.

Thai character measurements omit combining vowel and tone marks. Thai dialogue starts at the named 13 characters/second rate; this is a studio calibration starting point, not a universal estimate. Existing Chinese timing remains 4.5 characters/second.

## Changes

- **novel-outline:** Thai reports, content-language validation and source handling, localized generation-risk detection, Thai tests and documentation.
- **novel-characters:** Thai report UI, content-language-aware character fields, propagation from outline, English model prompt checks, Thai tests and documentation.
- **novel-art:** Thai reports, language-aware prop-scale validation, propagation from outline, Thai tests and documentation.
- **novel-script:** Thai reports, language-aware dialogue length and timing (13 base chars/sec for Thai, combining marks ignored), language propagation, Thai tests and documentation.
- **novel-storyboard:** Thai reports, language-aware frame/shot/dialogue checks and timing, language propagation, Thai tests and documentation.
- **character-refs:** Thai confirmation table and gallery UI (`th` added next to `zh` / `en` / `ja`), `contentLang` content validation for `th` / `en` / `ja`, English model prompts, Thai tests and documentation.
- **Assembler (`scripts/report.mjs`):** Thai navigation, help and status/error messages; first stage JSON `lang` supplies the default when `--lang` is omitted. Each skill is still rendered through its own CLI, with no cross-skill imports.
- **Documentation:** Root `README.th.md` plus a Thai README in all six skills, language switch badges/links matching the existing pattern, UI-language claims and selftest counts refreshed in the Chinese and English READMEs and the six SKILL.md files.

## Test counts

Baseline freshly verified before edits:

| Suite | Before | After |
| --- | ---: | ---: |
| character-refs | 230 | 241 |
| novel-art | 151 | 164 |
| novel-characters | 337 | 347 |
| novel-outline | 249 | 260 |
| novel-script | 154 | 175 |
| novel-storyboard | 323 | 331 |
| report assembler | 92 | 112 |
| **Total** | **1,536** | **1,630** |

All 1,630 assertions pass.

## Final verification

Commands (all run on this branch before the final commits):

```sh
for f in skills/*/scripts/selftest.mjs; do node "$f"; done
node scripts/report-selftest.mjs
```

Results: character-refs 241, novel-art 164, novel-characters 347, novel-outline 260, novel-script 175, novel-storyboard 331 — all passing; report assembler 112 passing.

Render evidence — every skill rendered its **own** examples with `--lang th` and `--lang en` (output kept out of version control in `/tmp/i18n-th/`):

- `novel-outline`: `render examples/渡口-outline.json --html --lang th|en` → `<html lang="th">`, Thai section headings and 导出-JSON → ส่งออก JSON labels; `--lang en` equivalent verified
- `novel-characters`: `render examples/สะพาน-cast.json --html --lang th|en` (the Thai-content fixture); `validate สะพาน-cast.json สะพาน.txt` passes with `lang=th, contentLang=th`
- `novel-art`: `render examples/渡口-art.json --html --lang th|en`
- `novel-script`: `render examples/渡口-script.json --html --lang th|en`
- `novel-storyboard`: `render examples/渡口-storyboard.json --html --script examples-path --lang th|en`
- `character-refs`: `intake-check examples/มะลิ-intake.json` prints the Thai confirmation table; `new` + `render --lang th|en` produce `<html lang="th">` reports
- Assembler: `report.mjs --from <demo with the five example JSONs> --lang th|en` → Thai pane labels (โครงเรื่อง / ตัวละคร / งานศิลป์ / บทละคร / สตอรีบอร์ด), Thai navigation and status lines
- Default path unchanged: `render` without `--lang` still emits `<html lang="zh">` with Chinese labels

## Limitations and open questions

- **Thai dialogue timing is a starting value.** 13 base characters/second (combining vowel and tone marks ignored) is a measure-based default for calibration, not a measured constant. Measure against real voice-over before production timing.
- **character-refs `intake-check` tail hint stays Chinese.** The line after the Thai confirmation table (`〔推断〕〔默认〕是自动补的…`) is an agent-facing CLI hint; per the design comment at the top of `i18n.mjs`, CLI hints are deliberately kept out of the UI string table. Left as upstream designed. If the studio wants it in Thai, it is a one-line change in `character-refs.mjs`.
- **UI dictionaries cover labels, not prose quality.** The Thai strings were written to read naturally, but the studio should review report wording (especially gate-failure text) once in real use and adjust the `th` dictionaries in place.
- **Per-language prompt protocol is Chinese/English only.** The H3/Seedance prompt protocol and prompt-language gates audit `zh` and `en` prompts; there is no `promptLang: "th"` (by upstream rule, prompts stay English for Thai productions — so this only matters if the studio later wants Thai on-screen dialogue tags).
- **Untested on other platforms.** Same caveat as upstream: verified on macOS + current Node only.

## Round 2 (2026-09-27)

Round 1 (above) established Thai/English UI and content-language support. Round 2 closes the nine gaps from `.codex-brief-2.md` / `demo-th/FINDINGS.md`. Per-skill commits bundle the fixes carried by that skill's files; every fix below names the regression assertions that guard it. **All nine are done; no existing assertion was deleted or loosened — each suite only grew.**

| # | Fix (from `.codex-brief-2.md`) | What was done | Commit | Guarding test |
| --- | --- | --- | --- | Round 1 → Round 2 |
| 1 | Outline rain keyword `ฝน` fires on the character name | `withoutCastNames()` strips cast names and aliases (longest first) before the risk-keyword scan, in every language | `0a9726e` | `selftest.mjs` 745: `withoutCastNames('ฝนพบพายุ', …) → 'พบ'` — 260 → **266** |
| 2 | One-syllable Thai names collide with ordinary words (`ต้น`/ต้นไม้, `ฝน`/ฝนตก) | Boundary-aware matching via `Intl.Segmenter('th')` with narrow lexical exceptions; zh/en keep substring matching. Applied in novel-characters (`promptContainsCharacterName`) and novel-storyboard (`containsBannedName` + `THAI_NAME_COMPOUNDS`) | `9325029` (characters), `15a8b09` (storyboard) | characters selftest 863–869 (ต้น hits, ต้นไม้/ตอนต้น/วัยต้น don't; ฝน hits, ฝนตก doesn't; zh/en unchanged) — 347 → **363**; storyboard selftest 203–208 — 331 → **346** |
| 3 | Seedance export mixes zh labels + Thai fields + en shot text | With `contentLang` th/en the whole model-facing block is English: labels, English `*Prompt` override fields (missing override = loud failure, not silent), English default constraints (no subtitles / no twins); dialogue keeps its spoken language in `{}` | `15a8b09` | storyboard selftest 216–225 (English labels + verbatim Thai dialogue; **「非中文 Seedance 默认约束也是英文」— the Round-1 failing assertion now passes with crowded-cut data**; missing-override throws) |
| 4 | CLI pass/fail output still Chinese with `--lang th` | `CLI_TEXT` th/en tables across novel-characters, novel-script, novel-art, novel-storyboard (outline already done in Round 1); usage, summaries, diagnostics, gate-skip notes all follow `--lang`; each new lane has a `spawnSync` regression asserting no CJK in Thai output | `9325029` (characters), `f89be2b` (script), `6c251fe` (art), `15a8b09` (storyboard) | characters CLI block (363 total), script problemText + CLI blocks (184), art `checkup --lang th` CLI block (170), storyboard CLI block (346) |
| 5 | `shotPrompt` undocumented | Documented the all-English rule and the `shotPrompt` / `*Prompt` override family in `schema.md`, `seedance-prompt.md`, `SKILL.md`, all three storyboard READMEs, and the root READMEs | `15a8b09` (storyboard), `d281f69` (root) | The documented contract is the behavior asserted by fix 3's tests (216–225) and the export-label test at 933; docs kept in sync in the same commits |
| 6 | novel-art `render` can't take the cast; skip text Chinese-only | `render --cast` runs the name-ban gate inside the report; omitting it announces the skip; gate failure/skip details translate via `gateText` (th/en) | `6c251fe` | art selftest `render --cast --lang th` + `checkup --lang th` CLI blocks — 164 → **170** |
| 7 | คัต vs ช็อต terminology split | GATE_LABELS_TH and all remaining UI now say ช็อต consistently (คัต removed) | `15a8b09` | storyboard selftest 1004–1007: rendered Thai report contains ช็อต and no คัต, gate labels included |
| 8 | Thai letter-spacing splits glyphs ("เ รื่ อ ง") | `html:lang(th)` (and `html:lang(en)`) `letter-spacing: normal` on headings/labels in outline, characters, script, art reports; assembler + character-refs already fixed in Round 1 | `0a9726e` (outline), `9325029` (characters), `f89be2b` (script), `6c251fe` (round-1-committed assembler/character-refs) | Each skill's selftest renders in Thai; story text preserved verbatim (existing assertions, all still passing) |
| 9 | Leftover zh in Thai UI ("รูปแบบ 抽核") | `ADAPT_MODE_LABELS` th/en (ซื่อตรง/สกัดแก่น/ยืมโครง, faithful/essence extraction/reframed) | `0a9726e` | outline selftest 747–751: Thai and English reports translate the adapt-mode label, zh untouched |

### Final counts

```sh
for f in skills/*/scripts/selftest.mjs; do node "$f"; done
node scripts/report-selftest.mjs
```

character-refs 244, novel-art 170, novel-characters 363, novel-outline 266, novel-script 184, novel-storyboard 346 — all passing; report assembler 113. Total 1,686 assertions, up from 1,630 at the end of Round 1, with zero assertions deleted or loosened.

Round 2 commits (all local on `feat/th-en-i18n`, author `codenamepoker2-gif`, not pushed):

- `0a9726e` Outline: exclude cast names from risk-keyword scan, translate adapt modes, Thai letter-spacing
- `9325029` Characters: Thai word-boundary name matching, localized CLI output
- `f89be2b` Script: localized CLI output, Thai letter-spacing
- `6c251fe` Art: render --cast runs the name-ban gate inside reports, Thai gate details
- `15a8b09` Storyboard: all-English Seedance for non-Chinese content, Thai name boundaries, localized CLI, shotPrompt docs, ช็อต terminology
- `d281f69` Docs: sync selftest counts and add root-README shotPrompt note

## Round 3 (2026-09-27)

Round 3 closes the two fixes from `.glm-brief-3.md`, both found on the live CineForge site. **No existing assertion was deleted or loosened** — the only expectation change is the single-episode gate (fix 1), which is the legitimate behaviour change itself, explained in the commit. No open questions came up; nothing needed escalation.

### Fix 1 — single-episode outline could never pass the `major-early` gate (`c300ce9`)

With `total === 1` the gate demanded a major beat before the last episode — impossible. The gate is now reported as **SKIPPED**, following the repo convention (「跳过要明说，不静默」): `ok: true` with a reason that the existing `isSkippedGate` predicate recognizes, localized per language —

- zh 「只有 1 集，不适用」 · th 「มีตอนเดียว จึงไม่ต้องตรวจข้อนี้」 · en "Single-episode outline — not applicable"

Skipped gates are excluded from both sides of the pass pill, so counts read "13/13 (1 skipped)"; HTML, Markdown, the gate alert and the CLI checkup all agree. `total ≥ 2` behaviour is untouched. Guarding tests: outline selftest — single-episode Thai fixture, skip reason + pill in th/en/zh HTML, Markdown, and `checkup` CLI in all three languages; the 2-episode case still passes the gate normally. 266 → **294**.

### Fix 2 — Chinese gate detail text leaked into Thai/English reports (`df3737a`)

`novel-outline` was the only skill whose gate *details* (failing-item reasons, template strings with episode numbers, risk-keyword names) rendered verbatim in th/en reports. The ad-hoc regex chains are replaced by ordered fragment tables (`GATE_DETAIL_TH` / `GATE_DETAIL_EN`) applied by a small `localize()` helper — table order carries the semantics (specific templates before generic fragments), and skip reasons resolve first via full-string maps so number templates can't mangle them. `gateText()` is now exported and feeds HTML, Markdown and the gate alert; skipped gates show their reason; the pass pill excludes skips.

The other five skills were audited rather than changed: **novel-art, novel-script and novel-storyboard** already render a generic localized failure detail in th/en reports (leak-free by construction); **character-refs** shows only gate labels from its i18n table; **novel-characters** has no gates. So fix 2's production change is outline-only — the rest of the work is the regression net: every skill's selftest now renders a th and an en report of a Thai example with a deliberately broken gate and asserts the gate panel contains no CJK characters (`novel-characters` asserts it has no gate section; `character-refs` asserts its th/en gate label and staleness tables are CJK-free).

### Final counts

```sh
for f in skills/*/scripts/selftest.mjs; do node "$f"; done
node scripts/report-selftest.mjs
```

character-refs 248, novel-art 173, novel-characters 366, novel-outline 378, novel-script 187, novel-storyboard 349 — all passing; report assembler 113. Total **1,814** assertions, up from 1,686 at the end of Round 2 (fix 1 added 28, fix 2 added 100), with zero assertions deleted or loosened.

Round 3 commits (local on `main`, author `codenamepoker2-gif`, **not pushed — the captain pushes**):

- `c300ce9` Outline: single-episode outlines skip major-early instead of failing
- `df3737a` Outline: localize every gate detail for Thai and English reports

## Round 4 (2026-09-27)

Round 4 closes the single fix from `.glm-brief-4.md`: the exported production pack (H3 and Seedance) addressed its human operator in Chinese regardless of UI language — `# E01-01 · H3 提示词`, `首帧 = **f1.png**。图片按 Picture 序号挂载：`, `Picture 1 = f1.png（**首帧**，钉 0.00 秒）`, `@图片1`, `（缺）`. No open questions came up; nothing needed escalation.

### What was done (`fbdb230`)

`exportPack` now resolves the pack's UI language with the same priority as `render` — `--lang` > JSON top-level `lang` field > `zh` (CLI passes `cliLangOf(rest, board)`; the board's own `lang` field works without any flag, and `--lang fr` is rejected before a single file is written). A `PACK_TEXT` table (zh / en / th) carries every operator-facing string:

- `prompt.md` / `seedance.md` titles (`# E01-01 · พรอมต์ H3`, `# E01-01 · Seedance prompt`)
- the Picture/attachment instruction lines (`เฟรมแรก = **f1.png** · แนบรูปตามลำดับ Picture:`, `Upload attachments in @Image order:`)
- per-image timing marks (`(**เฟรมแรก**, ปักที่ 0.00 วินาที)`, `(pinned at 3.00 s)`)
- the style/timing note, the missing mark (` (ขาด)` / ` (missing)`), the empty-attachments line
- manifest attachment tokens (`@图片N` ↔ `@ImageN`) and the program-written frame label (`分镜图 #N` ↔ `storyboard frame #N` / `ภาพสตอรีบอร์ด #N`)

**The prompt body below the `---` separator is untouched** — it is what gets sent to the video model and keeps following the existing `promptLang` / `contentLang` rules. Two content exceptions stay verbatim in every UI language, by design: the reference-sheet label (the sheet file name derives from that content name, so it is a filename, not UI text) and the story's dialogue.

**zh byte-identity is proven, not assumed:** the pre-change script (`git show HEAD:…`) and the new script both exported the 渡口 example through the real CLI into identically named directories for both protocols; `diff -r` reports the pack files *and* manifests identical. The zh table also holds the exact previous strings, and the selftest adds `JSON.stringify` deep-equality between the default and explicit-`zh` exports.

### Audit — export README and the root assembler zip notes

- **Skill READMEs (zh/en/th) + SKILL.md:** now document the rule — the pack's human-facing parts follow the report UI language, the body below `---` does not, sheet labels stay as content names. Selftest counts refreshed (346 → 536).
- **Root assembler (`scripts/report.mjs`):** audited — it has no export/zip-related output of its own (its CLI text was already localized in Round 1; 113 assertions pass). Nothing to change.
- **Root README demo-workdir section (the zip-packing convention, `manifest.json` + `E01-0x/`):** audited — it documents ASCII paths and the zh-default behavior, which is unchanged; no leak.

### Guarding tests (349 → 536, +187)

- zh byte-identity: explicit `lang: 'zh'` export deep-equals the default export, both protocols; zh headers/tokens unchanged
- board-level `lang: 'th'` produces Thai headers without any flag (mirrors the live demo-th board)
- for th and en, both protocols: every prompt.md/seedance.md header (above `---`) is CJK-free; every manifest is CJK-free; every segment's body below `---` is byte-equal to the zh export's body
- content spot-checks: Thai/English titles, leads, timing marks, `@ImageN` tokens, missing marks
- invalid language (`fr`) throws before writing
- CLI end-to-end: `export --lang th` (H3) and `--protocol seedance --lang en` write packs to a temp dir with translated headers, CJK-free CLI output, and a CJK-free manifest; temp dirs cleaned up in `finally`

### Final counts

```sh
for f in skills/*/scripts/selftest.mjs; do node "$f"; done
node scripts/report-selftest.mjs
```

character-refs 248, novel-art 173, novel-characters 366, novel-outline 378, novel-script 187, novel-storyboard **536** — all passing; report assembler 113. Total **2,001** assertions, up from 1,814 at the end of Round 3 (+187), with zero assertions deleted or loosened (selftest diff removes only one import line, rewritten as an expanded import).

Round 4 commits (local on `main`, author `codenamepoker2-gif`, **not pushed — the captain pushes**):

- `fbdb230` Storyboard: localize export pack headers and manifest labels for th/en
- *(this commit)* Docs: add Round 4 section to I18N-TH-REPORT.md
