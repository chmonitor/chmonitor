import { Button } from '@/components/ui/button'

export function HeaderButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-[12px] pointer-coarse:h-11"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}
