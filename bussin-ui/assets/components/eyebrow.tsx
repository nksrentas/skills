import type { ReactNode } from "react"

const TONES = { ink: "text-ink", sun: "text-sun", muted: "text-ash" } as const

function Mark() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0 fill-current">
      <path d="M6 0C6.6 3.6 8.4 5.4 12 6 8.4 6.6 6.6 8.4 6 12 5.4 8.4 3.6 6.6 0 6 3.6 5.4 5.4 3.6 6 0Z" />
    </svg>
  )
}

export function Eyebrow({
  children,
  tone = "ink",
  className = "",
}: {
  children: ReactNode
  tone?: keyof typeof TONES
  className?: string
}) {
  return (
    <p className={`flex items-center gap-2.5 text-eyebrow ${TONES[tone]} ${className}`}>
      <Mark />
      {children}
    </p>
  )
}
