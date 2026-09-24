# 61 — Design System

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `apps/web/src/styles.css`, built directly in this session. Uncommitted — see [92_CURRENT_STATE.md](92_CURRENT_STATE.md).

## Typography

Two-font pairing, loaded via Google Fonts in `index.html`: **Fraunces** (serif, display — headlines, the "premium editorial" register) and **Inter** (sans, body/UI text — clarity, legibility at small sizes).

## Color tokens (CSS custom properties, light mode default, dark-mode media-query variant included)

```css
--bg: #f6f4ef;              /* warm paper, not stark white */
--surface: #ffffff;
--ink: #1a1d23;              /* near-black, not pure black */
--ink-muted: #5b616e;
--ink-faint: #8b909c;
--border: #e6e2d9;
--accent: #253a5e;           /* deep navy-blue — the one accent color */
--accent-soft: #e9edf5;
--success: #1f6f4a;          /* deep green, not bright */
--warn: #8a5a1a;              /* amber-brown, restrained */
--danger: #8c2f2f;            /* deep red, restrained */
```

Dark-mode variants defined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`.

## Explicit anti-patterns avoided (per direct product instruction)

Excessive gradients, generic AI-chatbot appearance (no bubble-chat UI anywhere), meaningless percentage dashboards, developer/debug terminology, raw JSON, provider IDs, candidate counts, internal diagnostics, fake confidence scores, fake predictions, childish gamification (no badges/streaks/confetti).

## What was used instead

Strong typography hierarchy (`.headline`, `.eyebrow`, `.subtext` classes), generous spacing (`clamp()`-based responsive padding), a restrained badge/tag system for training-mode labels (`.badge`, `.mode-tag`), a calm evidence-list presentation (`.evidence-list`, `.evidence-item`) for autopsy observations, a clearly-differentiated `.hypothesis-box` (dashed border, warm background) for the unconfirmed-hypothesis presentation specifically — visually distinct from confirmed facts.

## Mobile responsiveness

Mobile-first CSS, no horizontal scroll, `.btn-row` collapses to a single column under 480px, all spacing uses `clamp()` rather than fixed breakpoints for most values.

## Component-level visual patterns

- `.timer` / `.timer-track` / `.timer-fill` — a visible, ticking clock plus a subtle progress bar that shifts color (`--accent` → `--warn`) once elapsed time exceeds the question's expected time.
- `.option` — multiple-choice buttons with distinct `.selected`/`.correct`/`.incorrect` states.
- `.result-icon` — a colored circular icon (✓/✕) rather than a jarring banner.
- `.confirm-question` + Yes/No buttons — deliberately simple, no ambiguity about what confirming means.

See also: [63_DASHBOARD.md](63_DASHBOARD.md)–[66_TRAINING_MODE_UX.md](66_TRAINING_MODE_UX.md) for how these tokens/classes are actually used per screen.
