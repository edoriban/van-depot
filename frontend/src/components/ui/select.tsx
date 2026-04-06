import * as React from "react"

import { cn } from "@/lib/utils"

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 w-full min-w-0 rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-base text-foreground transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "[&>option]:bg-popover [&>option]:text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Select }
