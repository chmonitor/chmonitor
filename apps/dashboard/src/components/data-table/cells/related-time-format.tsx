import { useTimezone } from '@/lib/context/timezone-context'
import dayjs from '@/lib/dayjs'

interface RelatedTimeFormatProps {
  value: any
}

export const RelatedTimeFormat = function RelatedTimeFormat({
  value,
}: RelatedTimeFormatProps) {
  const userTimezone = useTimezone()

  const fromNow = (() => {
    try {
      const parsed = dayjs.tz(value as string, userTimezone)
      return parsed.fromNow()
    } catch (_e) {
      // Failed to parse time with timezone, fallback to default parsing
      return dayjs(value as string).fromNow()
    }
  })()

  return <span title={value as string}>{fromNow}</span>
}
