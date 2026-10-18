# Dashboards

The template is a marketing site; it has no dashboard. This file derives one from the same tokens so an app and its landing page feel like one product. Where the landing page performs, the dashboard works: same materials, much less motion, denser spacing.

## What changes from the landing page

| Landing | Dashboard |
|---|---|
| 100px section padding | 24px page padding, 24px gaps between cards |
| `text-display`, `text-h2` | Page title `text-h3`, card titles `text-h6`, body `text-small` |
| Reveals on scroll | No scroll reveals. One fade-up on first mount of the page's cards: `y: 16 → 0`, `opacity 0 → 1`, 0.4s `power3.out`, stagger 0.05 |
| Lenis smooth scroll | Off inside the app shell; scrollable panels and tables scroll natively |
| Big photos | No photography in the working area; illustrations only in empty states |

The rolling button label, the colours, the radii and the tray card stay exactly the same.

## Shell

- Sidebar 260px, `bg-ink text-cream`, logo at top, nav items `h-10 rounded-full px-4 text-[14px] font-semibold`, active item `bg-sun text-ink`, hover `bg-cream/7`. Section labels inside the sidebar use `text-eyebrow text-stone`.
- Below 992px the sidebar becomes a drawer opened from a menu button in the top bar.
- Top bar 64px, `bg-canvas border-b border-line`, page title left, search pill and avatar right.
- Content area `bg-canvas p-6`, max width none; grids use `gap-6`.

## Cards

- KPI card: tray card with smaller inner padding (`p-6`), eyebrow label, value in `text-h2` (tabular numbers: `tabular-nums`), delta chip (`rounded-chip`, sun background for positive, `bg-oxford text-graphite` for neutral, `bg-cocoa/8 text-cocoa` for negative), sparkline below.
- Panel card: `rounded-card bg-white border border-line p-6` for tables and forms; the tray frame is reserved for highlights so it keeps meaning.
- Count-up on KPI values is allowed once on mount (GSAP `textContent` snap 1, 0.8s), never on refresh.

## Tables

Header row `text-eyebrow text-ash`, rows `h-14 border-b border-line text-small`, hover `bg-oxford/60`. Status uses chips, not coloured text. Row actions are icon buttons that appear on row hover and on focus. Long tables paginate; no infinite scroll in a smooth-scrolled shell.

## Forms

Inputs keep the pill look but at `h-11` in dense forms (`rounded-full px-4`), labels `text-small font-medium` above. Primary submit is `RollButton variant="primary"`, cancel is `outline`. Inline validation below the field in `text-cocoa`. Settings pages group fields in panel cards with a `text-h6` title and a one-line description.

## Charts

Series colours in order: ink `#191818`, sun `#f9b000`, bark `#6b4a30`, taupe `#8e7561`, stone `#908c8a`, lace `#e6decb`. Gridlines `line #ede9e5`, axis text `ash`. Single-series charts use ink with a sun highlight for the current point. Animate a chart once on first render (bars grow from the baseline, 0.6s `power3.out`), never on data refresh.

## Empty, loading and error states

- Loading: skeleton blocks `rounded-card bg-oxford animate-pulse`; no spinners for whole cards.
- Empty: centred illustration or icon in a 56px ink circle, `text-h5` title, one sentence, primary `RollButton`.
- Error: panel card with `text-cocoa` message and a retry `outline` button.

## Overlays

Modals and drawers: `rounded-card bg-canvas p-8`, backdrop `bg-ink/40 backdrop-blur-sm`, open with `opacity` and `y: 24 → 0` over 0.4s `power3.out`, close in 0.25s. Focus is trapped and returned; Escape closes.
