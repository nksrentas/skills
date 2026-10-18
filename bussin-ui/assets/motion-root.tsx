"use client"

import { useRef, type ReactNode } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { SplitText } from "gsap/SplitText"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText)

const REVEAL_FROM = {
  up: { x: 0, y: 100 },
  left: { x: -100, y: 0 },
  right: { x: 100, y: 0 },
} as const

const SPLIT_COLOR = { from: "#e9e5da", to: "#191818" }
const MARQUEE_SHIFT = { fast: -100, slow: -40 }
const MARQUEE_SECONDS = 10

function revealFrom(direction: string | undefined) {
  return direction === "left" || direction === "right" ? REVEAL_FROM[direction] : REVEAL_FROM.up
}

function revealDelay(value: string | undefined) {
  const delay = Number(value)
  return Number.isFinite(delay) && delay > 0 ? delay : 0
}

function animateReveals(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => {
    gsap.fromTo(
      element,
      { opacity: 0, ...revealFrom(element.dataset.reveal) },
      {
        opacity: 1,
        x: 0,
        y: 0,
        duration: 1,
        ease: "power3.out",
        delay: revealDelay(element.dataset.revealDelay),
        scrollTrigger: { trigger: element, start: "top bottom", once: true },
      },
    )
  })
}

function animateSplitColor(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-split-color]").forEach((element) => {
    SplitText.create(element, {
      type: "words,chars",
      aria: "auto",
      autoSplit: true,
      onSplit: (split) =>
        gsap.fromTo(
          split.chars,
          { color: SPLIT_COLOR.from },
          {
            color: SPLIT_COLOR.to,
            duration: 0.5,
            ease: "power1.in",
            stagger: 1,
            scrollTrigger: { trigger: element, start: "clamp(top bottom)", end: "clamp(60 top)", scrub: 2 },
          },
        ),
    })
  })
}

function animateMarquees(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-marquee]").forEach((element) => {
    const shift = element.dataset.marquee === "slow" ? MARQUEE_SHIFT.slow : MARQUEE_SHIFT.fast
    gsap.to(element.children, { xPercent: shift, duration: MARQUEE_SECONDS, ease: "none", repeat: -1 })
  })
}

export function MotionRoot({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const element = root.current
      if (!element) return
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        animateReveals(element)
        animateSplitColor(element)
        animateMarquees(element)
      })
      void document.fonts.ready.then(() => ScrollTrigger.refresh())
    },
    { scope: root },
  )

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  )
}
