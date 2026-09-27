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
