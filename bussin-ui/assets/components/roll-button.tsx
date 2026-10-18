import Link from "next/link"
import type { ComponentPropsWithoutRef } from "react"

const VARIANTS = {
  primary: "bg-sun px-8 py-[15px] text-button text-ink hover:bg-ink hover:text-cream focus-visible:bg-ink focus-visible:text-cream",
  dark: "bg-ink px-5 py-[5px] text-[14px] font-semibold leading-[1.25] text-cream",
  ghost: "border border-cream bg-cream/7 px-8 py-[15px] text-button text-cream hover:bg-cream hover:text-ink focus-visible:bg-cream focus-visible:text-ink",
  outline: "border border-ink px-8 py-[15px] text-button text-ink hover:border-cream hover:bg-cream focus-visible:border-cream focus-visible:bg-cream",
} as const

type Variant = keyof typeof VARIANTS

type RollButtonProps = { children: string; variant?: Variant; className?: string } & (
  | { href: string }
  | ({ href?: undefined } & Omit<ComponentPropsWithoutRef<"button">, "children" | "className">)
)

const ROOT = "group inline-flex items-center gap-3 rounded-full transition-colors duration-500 ease-linear"
const ROLL = "flex flex-col transition-transform duration-500 ease-linear group-hover:-translate-y-[18px] group-focus-visible:-translate-y-[18px]"
const SLIDE = "absolute top-0 size-[14px] transition-transform duration-500 ease-linear group-hover:translate-x-[18px] group-focus-visible:translate-x-[18px]"

function Arrow({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true" className={className}>
      <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Content({ label }: { label: string }) {
  return (
    <>
      <span className="block h-[18px] overflow-hidden leading-[18px]">
        <span className={ROLL}>
          <span className="h-[18px] whitespace-nowrap">{label}</span>
          <span className="h-[18px] whitespace-nowrap" aria-hidden="true">
            {label}
          </span>
        </span>
      </span>
      <span className="relative size-[14px] shrink-0 overflow-hidden">
        <Arrow className={`${SLIDE} left-0`} />
        <Arrow className={`${SLIDE} -left-[18px]`} />
      </span>
    </>
  )
}

export function RollButton(props: RollButtonProps) {
  const { children, variant = "primary", className = "" } = props
  const classes = `${ROOT} ${VARIANTS[variant]} ${className}`

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={classes}>
        <Content label={children} />
      </Link>
    )
  }

  const { href: _href, children: _children, variant: _variant, className: _className, type = "button", ...buttonProps } = props
  return (
    <button type={type} className={classes} {...buttonProps}>
      <Content label={children} />
    </button>
  )
}
