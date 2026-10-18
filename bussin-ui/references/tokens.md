# Tokens

Measured from the live template stylesheet and computed styles on 2026-10-18. Tailwind names on the left are what `assets/theme.css` defines.

## Colour

| Tailwind | Hex | Source variable | Use |
|---|---|---|---|
| `canvas` | `#f7f7f2` | `--_colors---body-bg` | Page background, inner card surface |
| `ink` | `#191818` | `--_colors---theme-dark` | Text, dark sections, dark buttons, icon circles |
| `sun` | `#f9b000` | `--_colors---theme-color` | Primary button, accent eyebrow on dark |
| `cream` | `#fffeea` | `--_colors---text-light` | Text on dark and on photos, chips on images |
| `lace` | `#e6decb` | `--_colors---vintage-lace` | Tray frames, quote cards |
| `flour` | `#e9e5da` | `--_colors---flour` | Un-revealed text colour in scroll-coloured headings, soft fills |
| `oxford` | `#e9e7e3` | `--_colors---oxford-white` | Subtle fills, table stripes |
| `line` | `#ede9e5` | `--_colors---border` | Borders, dividers, input borders, slider arrows |
| `cocoa` | `#481f00` | `--_colors---theme-text` | Warm emphasis text, icon backgrounds at 8% |
| `bark` | `#6b4a30` | `--_colors---text-medium-dark` | Secondary warm text |
| `taupe` | `#8e7561` | `--_colors---text-light-two` | Muted warm text, chart series |
| `graphite` | `#444141` | `--_colors---text-color-three` | Secondary body text |
| `ash` | `#727171` | `--_colors---text-color-four` | Tertiary text, captions |
| `stone` | `#908c8a` | `--_colors---fashion-gray` | Placeholders, disabled |

Translucent values used as-is: cream at 7% (`bg-cream/7`) for ghost buttons on dark or photo backgrounds, cream at 7% for borders on dark (`#fffeea12`), white at 84% with `backdrop-blur-[20px]` for dropdown menus, `#f6f3f0cc` and `#f7f7f2cc` for frosted panels over images, black at 9% for image overlays.

## Type

Family: Parkinsans for everything. Tracking is -0.32px unless noted.

| Utility | Desktop ≥992 | Tablet 768-991 | Mobile <768 | Line height | Weight |
|---|---|---|---|---|---|
| `text-display` (h1) | 70px | 60px | 38px | 99% | 600, tracking -0.8px |
| `text-h2` | 48px | 38px | 26px | 115% | 500 |
| `text-h3` | 32px | 30px | 22px | 134% | 500 |
| `text-h4` | 24px | 24px | 20px | 120% | 500 |
| `text-h5` | 20px | 20px | 20px | 128% | 500 |
| `text-h6` | 16px | 16px | 16px | 105% | 500 |
| `text-lead` | 18px | 18px | 18px | 155% | 400 |
| `text-body` | 16px | 16px | 16px | 155% | 400 |
| `text-small` | 14px | 14px | 14px | 155% | 400 |
| `text-eyebrow` | 14px | 14px | 14px | 134% | 600, uppercase, tracking +0.64px |
| `text-button` | 16px | 16px | 16px | 125% | 600, tracking 0 |

Display, h2, h3 and h4 were measured at all three widths. The smaller sizes were only measured on desktop; the template does not appear to scale them, so they stay fixed. Nav links are 14px/600. Card titles are 18 to 20px/500 (`text-h5`). Quotes are `text-h4`.

## Spacing

| Token | Value | Use |
|---|---|---|
| Section padding | 100 / 70 / 50px | Vertical padding of each section by breakpoint |
| Page gutter | 20px desktop and tablet, 10px mobile | Horizontal padding of sections |
| Frame inset | 10px | Hero and footer frames sit 10px inside the viewport |
| Spacing scale | 5, 10, 15, 24, 32, 43, 50, 60 | Gaps inside components; 24px is the default card gap |
| Content widths | 900px reading, 1180px wide, 1240px grid | `max-w-[900px]` for centred text sections |
| Hero overlap | -200px | The first section after the hero overlaps it by 200px |

## Radius

| Tailwind | Value | Use |
|---|---|---|
| `rounded-card` | 24px | Image frames, trays, inner cards, hero, footer panel, header bottom corners |
| `rounded-panel` | 12px | Dropdown menus, small panels |
| `rounded-field` | 8px | Compact controls in dashboards |
| `rounded-chip` | 6px | Date chips; 4px for small tags |
| `rounded-full` | pill | Buttons, inputs, icon circles, slider arrows |

## Breakpoints

`sm` 480px, `md` 768px, `lg` 992px, `xl` 1280px, `2xl` 1440px. The template designs desktop-first at 992px and collapses to one column below 768px.

## Elevation

The template has almost no shadows. Depth comes from the tray frame (lace around canvas), from frosted panels over photos (`backdrop-blur-[15px]` with canvas at 80%), and from the dark ink sections. Use `shadow-none` by default; a floating menu may take `shadow-[0_20px_40px_-20px_rgb(25_24_24/0.25)]`.
