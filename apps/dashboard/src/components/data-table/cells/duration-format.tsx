import dayjs from '@/lib/dayjs'

interface DurationFormatProps {
  value: string | number
}

export const DurationFormat = function DurationFormat({
  value,
}: DurationFormatProps): React.ReactNode {
  const humanized = (() => {
    const seconds = parseFloat(value as string)

    if (Number.isNaN(seconds)) {
      return value
    }

    return dayjs.duration({ seconds }).humanize(seconds < 0) // 2 minutes "ago" for negative values
  })()

  return <span title={value as string}>{humanized}</span>
}
