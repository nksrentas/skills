# Components

Anatomy and Tailwind recipes measured from the template. Class strings assume `assets/theme.css`. Components marked "asset" exist as code in `assets/components/`; the rest are recipes to build per project.

## Button (asset: `roll-button.tsx`)

Pill, `px-8 py-[15px]`, `gap-3`, `text-button`. Rolling label and sliding arrow as described in `motion.md`.

| Variant | Rest | Hover | Use |
|---|---|---|---|
| `primary` | sun bg, ink label | ink bg, cream label | The one main action per view |
| `dark` | ink bg, cream label, `px-5 py-[5px]`, 14px | label rolls 25px | Header call to action |
| `ghost` | cream/7% bg, 1px cream border, cream label | cream bg, ink label | Second action on photos or ink sections |
| `outline` | transparent, 1px ink border, ink label | cream bg, cream border | Secondary action on canvas |

Buttons are links when they navigate (`href`) and `<button>` otherwise. Two buttons side by side: primary then ghost or outline, `gap-[15px]`, wrap on mobile.

## Header

A floating bar, not a full-width strip: `absolute top-0 inset-x-0 z-50 px-5`, inner `mx-auto max-w-[850px] h-[66px] rounded-b-card bg-canvas backdrop-blur-[15px] px-[15px] flex items-center justify-between`. Logo left (about 78x28), nav centre with 14px/600 links and `gap-6`, dark `RollButton` right. The current page link is the only one underlined. Dropdowns follow `motion.md` §3, panel `rounded-panel bg-white/84 backdrop-blur-[20px] p-6`, items 14px/500.

Below 992px the nav collapses into a menu button that opens a full-width panel under the bar with the same canvas surface and 24px padding; lock Lenis while it is open.

## Hero

- Frame: the section has `px-5 pt-2.5`, and the media sits in an absolutely positioned frame `inset-x-2.5 top-2.5 h-[1000px] rounded-card overflow-hidden` with a video or image `object-cover` and a 9% black overlay.
- Content centred, `text-display text-cream max-w-[650px] text-center`, buttons below with 32px gap: primary + ghost.
- Bottom padding of 370px leaves room for the next section to overlap by -200px.
- Mobile: frame height follows content, `pt-[50px] px-2.5`, display drops to 38px.

## Section head

Eyebrow (asset: `eyebrow.tsx`): a 12px mark plus `text-eyebrow`, `gap-2.5`. Ink on canvas, sun on ink sections. Then a `text-h2` heading at `max-w-[605px]`, then optional `text-body` at `max-w-[600px]` with 24px gaps. Centred heads use `mx-auto text-center`. On the right of a head, a text link with underline plus two 48px round slider arrows (`rounded-full border border-line`).

## Tray card (asset: `tray-card.tsx`)

The template's signature card: a lace frame `rounded-card bg-lace p-2.5` holding an inner `rounded-card bg-canvas px-6 py-[60px]` card, and optionally a footer row inside the frame below the inner card (`px-2.5 text-small`, for a date or a meta line). Used for feature lists, quotes, ratings and highlights. Cards in a row are equal height with `gap-6`.

## Feature list inside a card

Title `text-h3`, then a list where each item is `flex gap-4 pb-4` with a 20px line icon and 16px text, separated by `border-b border-line` except the last.

## Image card with frosted caption

For programmes, events and articles: `relative rounded-card overflow-hidden` image, and a caption panel inset 10px from the bottom `absolute inset-x-2.5 bottom-2.5 rounded-card bg-canvas/80 backdrop-blur-[15px] p-6` holding a chip, `text-h5` title, `text-body` text and an outline `RollButton`. Event cards put a date chip on the image's top left instead.

## Chips

- Tag: `rounded-[4px] bg-cream px-2.5 py-[5px] text-[14px] font-semibold`.
- Date: `rounded-chip bg-cream pl-[15px] pr-6 py-[5px] text-[14px] font-medium uppercase`.

## Icon list (benefits)

Rows `flex gap-6 py-5` separated by `border-b border-line`. Icon in a 56px `rounded-full bg-ink` circle with a 20px cream line icon. Title `text-[18px] font-medium`, text `text-small text-graphite`.

## Statement section

Eyebrow centred, then the scroll-coloured statement (`motion.md` §5): `text-h3 max-w-[900px] mx-auto text-center`. Follow it with a two-column row: a large rounded image with frosted stat chips ("12k+ students") and a tray card.

## Dark band

An ink section (`bg-ink py-[100px]`) for galleries or highlights: sun eyebrow, cream heading, image slider of `rounded-card` photos that bleed off the right edge. Ghost buttons only.

## Testimonials

Left: a tall `rounded-card` photo with a quote panel. Right: stacked tray cards with the quote in `text-h4`, then an avatar (40px round), name `text-h6` and role `text-small text-graphite`, and a date in the tray footer. Centred section head above.

## Slider

Horizontal track of cards with `gap-6`, pages by groups (3 on desktop, 1 on mobile), 48px round outline arrows, infinite wrap. Build with CSS scroll snap (`snap-x snap-mandatory overflow-x-auto`, `data-lenis-prevent`) and arrow buttons that call `scrollBy` with the card width; animate nothing else. Keyboard: arrows are real buttons with labels.

## Inputs

Pill fields: `h-[60px] rounded-full bg-white border border-line px-[25px] text-body placeholder:text-stone`. An inline submit sits inside the field's right edge as a dark pill. Focus: `outline-2 outline-offset-4 outline-ink`. Errors go below the field in `text-small text-cocoa`.

## Footer

A full-bleed `rounded-t-card` photo block with `pt-[315px] px-[50px] pb-[50px]` carrying a centred `text-display text-cream` call to action and two buttons, then a `rounded-card bg-canvas` panel inside it (`pt-[100px] px-5`) with: newsletter field on the left, link columns with eyebrow-style column titles (`text-eyebrow text-ash`), and a bottom row with copyright and social icons, `border-t border-line`.

## Marquee

`overflow-hidden` row with `data-marquee`, containing two identical tracks `flex min-w-full shrink-0 justify-around gap-[60px] pr-[60px]`. `min-w-full` matters: a track narrower than the viewport leaves a visible gap at the end of each cycle. Logos at 60% opacity in ink.

## Accessibility baseline

Visible focus on every interactive element (`focus-visible:outline-2 outline-offset-4`), text on photos always over the 9% overlay or a frosted panel, cream on sun is not allowed (contrast too low), icon-only buttons carry `aria-label`, menus close on Escape.
