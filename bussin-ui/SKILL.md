---
name: bussin-ui
description: House UI system for landing pages and dashboards in Next.js, Tailwind CSS v4, GSAP and Lenis, modelled on the Edefy template - cream canvas, Parkinsans type, rolling-label pill buttons, tray cards, rise-in reveals. Use whenever building or restyling a landing page, hero, pricing or feature section, dashboard or settings screen where the user wants "our style" or "our usual style", the Edefy look, or says "make it look like our other sites".
argument-hint: "[page, section or screen to build or restyle]"
---

# bussin-ui

A warm, editorial look: off-white canvas, near-black ink, one saturated accent (sun yellow), big rounded image frames, cards that sit inside a beige "tray", and motion that is slow, smooth and sparse. The values here were measured from the live template on 2026-10-18, so use them as given instead of approximating.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js App Router, React Server Components by default |
| Styling | Tailwind CSS v4, tokens in `@theme` from `assets/theme.css` |
| Font | Parkinsans 300 to 700 via `next/font/google`, exposed as `--font-parkinsans` |
| Animation | GSAP 3.15+ with ScrollTrigger and SplitText (free since 3.13), `@gsap/react` for `useGSAP` |
| Smooth scroll | Lenis via `lenis/react`, driven by the GSAP ticker |
| Hover micro-motion | CSS transitions in Tailwind classes, so server components stay server components |

GSAP owns everything scroll-driven, sequenced or timed. Hover and focus states use CSS transitions with the same durations, because a pointer state needs no JavaScript and works before hydration. Do not add Framer Motion, AOS, react-spring or another scroll library next to these.

## Setting up a project

Copy from `assets/` into the app, keeping kebab-case names:

| Asset | Goes to | What it gives you |
|---|---|---|
| `theme.css` | `src/app/globals.css` (merge) | Colours, radii, breakpoints, type utilities, reveal pre-state |
| `smooth-scroll.tsx` | `src/shared/motion/` | Lenis root synced with ScrollTrigger, respects reduced motion |
| `motion-root.tsx` | `src/shared/motion/` | One client boundary that animates every `data-reveal`, `data-split-color` and `data-marquee` inside it |
| `components/roll-button.tsx` | `src/shared/ui/` | The pill button with rolling label and sliding arrow |
| `components/eyebrow.tsx` | `src/shared/ui/` | Small uppercase section label with its mark |
| `components/tray-card.tsx` | `src/shared/ui/` | Beige frame around a canvas card |

These are the shared kit from `bussin-ts-architecture`. Sections, pages and components that belong to one feature live in that feature's folder and import only from `src/shared/`, never from another feature.

Install: `gsap @gsap/react lenis` and Tailwind v4 (`tailwindcss @tailwindcss/postcss`). In the root layout load the font and wrap the body:

```tsx
const parkinsans = Parkinsans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-parkinsans" })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={parkinsans.variable}>
      <body className="bg-canvas font-sans text-ink antialiased">
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  )
}
```

Add `<noscript><style>{"[data-reveal]{opacity:1!important;transform:none!important}"}</style></noscript>` in `<head>`. Each page wraps its content in `<MotionRoot>`; sections stay server components and opt into motion with data attributes. A `data-reveal` outside a `MotionRoot` stays invisible, so the root goes in the page, not in individual sections. `next/font` warns that it has no fallback metrics for Parkinsans; that is harmless.

Verified on 2026-10-18 with Next.js 16.4, React 19.3, Tailwind 4, GSAP 3.15, Lenis 1.3.26: production build, reveals, reduced-motion path, split-colour scrub, marquee loop, button roll and the responsive type scale at 390, 800 and 1280px.

## Reference files

Read the one that matches the work before writing markup:

- `references/tokens.md`: every colour, the type scale at three breakpoints, spacing, radii, breakpoints. Read before choosing any value.
- `references/components.md`: anatomy and Tailwind recipes for buttons, header, hero, section heads, tray cards, image cards, chips, icon lists, testimonials, sliders, inputs, footer, marquee.
- `references/motion.md`: every animation with exact duration, easing, distance, trigger and delay rules, plus Lenis and reduced-motion handling.
- `references/dashboard.md`: how the same language becomes an app shell, data cards, tables, forms and charts without turning a dashboard into a landing page.

## Accessibility and SEO

Every page and component built with this skill also follows `bussin-a11y`, and every public page follows `bussin-seo` and `bussin-schema`. Load them alongside this skill; the house look never overrides semantic HTML, contrast, focus or metadata.

## Animation skills

Motion craft comes from Emil Kowalski's skills ([emilkowalski/skills](https://github.com/emilkowalski/skills), MIT). Install them once:

```bash
npx skills add emilkowalski/skills --skill emil-design-eng --skill animate --skill find-animation-opportunities --skill improve-animations --skill review-animations --skill animation-performance --skill animation-vocabulary --skill apple-design
```

| Job | Skill |
|---|---|
| Decide whether something should move at all, and how polish should feel | `emil-design-eng` |
| Build a new animation: purpose, properties, curve, duration | `animate` |
| Find places that should animate and do not | `find-animation-opportunities` |
| Audit the motion a project already has and plan fixes | `improve-animations` |
| Review new animation code before calling it done | `review-animations` |
| Keep animations inside the frame budget, including GSAP | `animation-performance` |
| Turn "the bouncy thing" into the exact term | `animation-vocabulary` |
| Springs, drag, swipe and sheet gestures | `apple-design` |

These skills decide whether and how something moves. This skill decides what the house motion is. When they disagree, this skill wins on:
- the stack: GSAP for anything scroll-driven, sequenced or timed, CSS transitions for hover and focus, and no Motion/Framer Motion
- the exact values in `references/motion.md`

Emil's skills win on everything this skill does not pin down. When they are not installed, follow `references/motion.md` alone.

## Rules that make it look right

- One accent. Sun `#f9b000` is for the primary action and small highlights; everything else is ink, canvas, cream and the warm neutrals. Two yellow buttons side by side is already one too many.
- Ink is `#191818`, never pure black; canvas is `#f7f7f2`, never pure white. Pure white only appears inside inputs and glass menus.
- Headings are Parkinsans 500, the display size 600, with negative tracking (-0.32px, -0.8px for display). Body text is 16px at 155% line height.
- Large surfaces are rounded 24px: hero frame, image cards, trays, footer. Small things are pills (buttons, inputs) or 4 to 6px chips.
- Sections breathe: 100px vertical padding on desktop, 70px tablet, 50px mobile. The page sits 10 to 20px inside the viewport so rounded frames read as objects.
- Motion is slow and rare: content rises 100px over one second with `power3.out`, once. Nothing bounces, nothing loops except marquees.
- Every animation has a reduced-motion path where content is simply visible.

## Assets are not the brand

Use the system, not Edefy's content: write your own copy, use your own photography and logo, and never hotlink `cdn.prod.website-files.com`. Parkinsans is under the SIL Open Font License, so it is fine to ship. If a page is meant to be a pixel copy of the template itself for commercial use, the Webflow template licence covers that, not this skill.

## Review checklist

When bussin-autoloop loads this skill, copy this list into `CODING_STANDARDS.md` so the review stage enforces it, and add `review:review-animations` to the loop's skills when `review-animations` is installed:

- Colours, radii, spacing and type come from the theme tokens and utilities; no raw hex values or arbitrary pixel sizes in components.
- Only one sun-yellow primary action per view.
- Buttons use `RollButton`; no ad hoc button styles.
- Section-level components are server components; client code is limited to `MotionRoot`, `SmoothScroll` and interactive widgets.
- Every reveal uses `data-reveal` with the documented directions and delays; no inline GSAP tweens in sections.
- Reduced motion leaves all content visible and unanimated; verified with the OS setting or an emulated media query.
- Images use `next/image` with explicit sizes, rounded frames clip with `overflow-hidden`.
- Interactive elements have visible focus states and work with the keyboard.
- Dashboards follow `references/dashboard.md`: no scroll reveals on data, no smooth scroll inside scrollable panels.
