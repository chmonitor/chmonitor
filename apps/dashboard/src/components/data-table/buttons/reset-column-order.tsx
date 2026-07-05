import { ResetIcon } from '@radix-ui/react-icons'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface ResetColumnOrderButtonProps {
  onReset: () => void
  disabled?: boolean
}

export const ResetColumnOrderButton = function ResetColumnOrderButton({
  onReset,
  disabled = false,
}: ResetColumnOrderButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-8 opacity-40 hover:opacity-100 transition-opacity rounded-full"
              onClick={onReset}
              disabled={disabled}
              aria-label="Reset column order"
            />
          }
        >
          <ResetIcon className="size-3 sm:size-3" strokeWidth={2} />
        </TooltipTrigger>
        <TooltipContent>
          <p>Reset column order to default</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
