import { Star } from 'lucide-react'

import { SaveFavoriteDialog } from './save-favorite-dialog'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useQueryFavorites } from '@/lib/stores/use-query-favorites'
import { cn } from '@/lib/utils'

export interface SaveFavoriteButtonProps {
  sql: string
  hostId: number
  database: string | null
}

export function SaveFavoriteButton({
  sql,
  hostId,
  database,
}: SaveFavoriteButtonProps) {
  const { isFavorited } = useQueryFavorites()
  const [open, setOpen] = useState(false)

  const trimmed = sql.trim()
  const already = trimmed ? isFavorited(trimmed) : false

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                disabled={!trimmed}
                onClick={() => {
                  if (!already) setOpen(true)
                }}
                className={cn(already && 'text-amber-500')}
                aria-label={
                  already ? 'Already saved as favorite' : 'Save as favorite'
                }
              />
            }
          >
            <Star
              className={cn(
                'size-3.5',
                already && 'fill-amber-500 text-amber-500'
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            {already ? 'Saved as favorite' : 'Save as favorite'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <SaveFavoriteDialog
        open={open}
        onOpenChange={setOpen}
        sql={sql}
        hostId={hostId}
        database={database}
      />
    </>
  )
}
