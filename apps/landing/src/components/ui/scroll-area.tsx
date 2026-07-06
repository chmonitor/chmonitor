import type * as React from 'react'

import { cn } from '@/lib/utils'

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="scroll-area"
      className={cn('overflow-y-auto', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
