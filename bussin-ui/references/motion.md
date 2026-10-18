# Motion

The template has 223 interaction bindings, but they reduce to six recipes. The values below come from its published GSAP definitions (GSAP 3.15.0 with ScrollTrigger and SplitText). Reproduce these; do not invent new ones without a reason the user agreed to.

## 1. Reveal (198 of 223 bindings)

Content rises into place once as it enters the viewport.

| Property | Value |
|---|---|
| From | `opacity: 0`, `y: 100` (up); `x: -100` (left); `x: 100` (right) |
| To | `opacity: 1`, `x: 0`, `y: 0` |
| Duration | 1s |
| Ease | `power3.out` (quartic ease-out) |
| Trigger | element top reaches viewport bottom (`start: "top bottom"`), plays once, never reverses |
| Delay | per element, in 0.1s steps from 0 to 1.2s; siblings in a row use 0.2, 0.3, 0.4 ... |

Markup: `data-reveal` (up), `data-reveal="left"`, `data-reveal="right"`, plus optional `data-reveal-delay="0.3"`. `MotionRoot` handles the rest. Left and right are rare: use them for the two halves of a split section, nowhere else.

Delay rules that keep it calm: a heading block is 0 to 0.2, its paragraph 0.1 later, its button 0.1 after that. Cards in a row step by 0.1. Never exceed 0.6 on anything a user is waiting to read; the template's 1.2s delays are on decorative items only.

## 2. Rolling button label (all buttons)

Pure CSS, built into `RollButton`.

| Part | Behaviour |
|---|---|
| Label | Two stacked copies inside an 18px `overflow-hidden` box; on hover both move up 18px, so the second copy replaces the first. The template's header button rolls 25px because of extra padding; `RollButton` uses 18px everywhere |
| Arrow | Two arrows in a 14px clipped box, second one parked 18px to the left; on hover both move right 18px |
| Colours | Primary: sun background becomes ink, label becomes cream. Ghost on dark: cream/7% becomes cream, label becomes ink. Outline on light: transparent becomes cream, border ink becomes cream |
| Timing | 0.5s linear for all properties (header button 0.4s) |

Hover and keyboard focus trigger the same state (`group-hover` and `group-focus-visible`).

## 3. Dropdown menu

| State | Values |
|---|---|
| Closed | `opacity: 0`, `scale: 0.6` from the top centre, `pointer-events: none` |
| Open | `opacity: 1`, `scale: 1` over 0.5s, `cubic-bezier(0.42, 0, 0.58, 1)` |
| Closing | the same back to closed over 1s |

CSS transitions on `group-hover` / `group-focus-within` are enough. The panel is white at 84% with `backdrop-blur-[20px]`, `rounded-panel`, 24px padding.

## 4. Marquee (logo rows, feature tickers)

Two identical tracks side by side, both animated `xPercent: 0 → -100`, 10s per cycle, linear, infinite. A slower variant moves `xPercent: -40` over 10s for a row of large images. Markup: a wrapper with `data-marquee` (or `data-marquee="slow"`) containing exactly two copies of the track. Pause on hover is not in the original; add it only if the row contains links.

## 5. Scroll-coloured statement (one per page at most)

A large statement paragraph (`text-h3`, max-w 900px, centred) whose characters change from `flour #e9e5da` to `ink #191818` as you scroll.

| Property | Value |
|---|---|
| Split | SplitText `words,chars`, words kept intact so lines wrap naturally, `aria: "auto"` |
| Tween | `color` from flour to ink, duration 0.5, `stagger: 1`, ease `power1.in` |
| ScrollTrigger | `start: "clamp(top bottom)"`, `end: "clamp(60 top)"`, `scrub: 2` |

Markup: `data-split-color` on the paragraph. Split only after fonts load (`document.fonts.ready`), otherwise line breaks shift.

## 6. Smooth scroll

Lenis with `lerp: 0.1`, `smoothWheel: true`, `syncTouch: false` (touch stays native), `anchors: true`, driven by `gsap.ticker` with `lagSmoothing(0)` and `lenis.on("scroll", ScrollTrigger.update)`. `assets/smooth-scroll.tsx` does exactly this. Stop Lenis while a modal, drawer or lightbox is open (`useLenis()` then `lenis.stop()` / `lenis.start()`), and mark scrollable children with `data-lenis-prevent` so they scroll natively.

## Lifecycle rules

- All GSAP runs inside `useGSAP` with a `scope`, so it reverts on unmount and route change.
- Build animations after `document.fonts.ready`, then call `ScrollTrigger.refresh()`. Refresh again when late images load if they change layout; giving images explicit dimensions avoids most refreshes.
- Use `gsap.matchMedia()` with `(prefers-reduced-motion: reduce)`: in that branch nothing animates, Lenis is not created, and everything with `data-reveal` is set visible.
- The pre-animation hidden state lives in CSS (`theme.css`) under `prefers-reduced-motion: no-preference`, so nothing flashes before hydration; GSAP animates from it with `fromTo`. Add `<noscript><style>[data-reveal]{opacity:1!important;transform:none!important}</style></noscript>` in the layout so content is never lost without JavaScript.
- Do not put `data-reveal` on the hero heading if it is the largest contentful paint on a slow page; reveal its buttons and secondary text instead.
- Never animate layout properties (width, height, top). Only `transform`, `opacity`, `color`, `background-color`.
