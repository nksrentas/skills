import type { ReactNode } from "react"

export function TrayCard({
  children,
  footer,
  className = "",
  innerClassName = "px-6 py-[60px]",
}: {
  children: ReactNode
  footer?: ReactNode
  className?: string
  innerClassName?: string
}) {
  return (
    <div className={`flex flex-col gap-[15px] rounded-card bg-lace p-2.5 ${className}`}>
      <div className={`flex-1 rounded-card bg-canvas ${innerClassName}`}>{children}</div>
      {footer ? <div className="px-2.5 text-small text-ink">{footer}</div> : null}
    </div>
  )
}
