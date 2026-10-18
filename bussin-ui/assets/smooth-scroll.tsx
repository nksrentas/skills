"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import Lenis from "lenis"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

const LENIS_OPTIONS = { lerp: 0.1, smoothWheel: true, syncTouch: false, anchors: true, autoRaf: false }

const SmoothScrollContext = createContext<Lenis | null>(null)

export const useSmoothScroll = () => useContext(SmoothScrollContext)

export function SmoothScroll({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null)

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let instance: Lenis | null = null
    const tick = (time: number) => instance?.raf(time * 1000)

    const stop = () => {
      gsap.ticker.remove(tick)
      instance?.destroy()
      instance = null
      setLenis(null)
    }

    const sync = () => {
      stop()
      if (reducedMotion.matches) return
      instance = new Lenis(LENIS_OPTIONS)
      instance.on("scroll", ScrollTrigger.update)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
      setLenis(instance)
    }

    sync()
    reducedMotion.addEventListener("change", sync)
    return () => {
      reducedMotion.removeEventListener("change", sync)
      stop()
    }
  }, [])

  return <SmoothScrollContext.Provider value={lenis}>{children}</SmoothScrollContext.Provider>
}
