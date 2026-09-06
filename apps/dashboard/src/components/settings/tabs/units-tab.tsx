import { Binary, Hash } from 'lucide-react'

import type {
  ByteUnit,
  NumberFormat,
  UserSettings,
} from '@/lib/types/user-settings'
import type { SegmentedOption } from '../segmented-control'

import { Field } from '../field'
import { SegmentedControl } from '../segmented-control'
import { TabsContent } from '@/components/ui/tabs'
import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'

/** Sample byte value (1.5 GiB) used for the live units preview. */
const BYTE_PREVIEW_SAMPLE = 1.5 * 1024 ** 3
/** Sample quantity (1,200,000) used for the live numbers preview. */
const NUMBER_PREVIEW_SAMPLE = 1_200_000

export function UnitsTab({
  settings,
  onUpdate,
}: {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
}) {
  // Live previews reflect the selected unit explicitly (independent of the
  // global format snapshot), so the example updates as the user toggles.
  const binaryExample = formatReadableSize(BYTE_PREVIEW_SAMPLE, 1, 'binary')
  const decimalExample = formatReadableSize(BYTE_PREVIEW_SAMPLE, 1, 'decimal')
  const abbreviatedExample = formatReadableQuantity(
    NUMBER_PREVIEW_SAMPLE,
    'short'
  )
  const fullExample = formatReadableQuantity(NUMBER_PREVIEW_SAMPLE, 'long')

  const byteUnitOptions: readonly SegmentedOption<ByteUnit>[] = [
    { value: 'binary', label: 'Binary', description: binaryExample },
    { value: 'decimal', label: 'Decimal', description: decimalExample },
  ]
  const numberFormatOptions: readonly SegmentedOption<NumberFormat>[] = [
    {
      value: 'abbreviated',
      label: 'Abbreviated',
      description: abbreviatedExample,
    },
    { value: 'full', label: 'Full', description: fullExample },
  ]

  return (
    <TabsContent value="units" className="space-y-5 px-1 pb-2">
      <Field
        label="Byte sizes"
        icon={Binary}
        description="Binary is 1024-based (KiB, MiB, GiB). Decimal is 1000-based (KB, MB, GB)."
      >
        <SegmentedControl
          ariaLabel="Byte sizes"
          value={settings.byteUnit}
          onChange={(value) => onUpdate({ byteUnit: value })}
          options={byteUnitOptions}
        />
      </Field>

      <Field
        label="Large numbers"
        icon={Hash}
        description="Abbreviated uses compact suffixes. Full shows grouped digits."
      >
        <SegmentedControl
          ariaLabel="Large numbers"
          value={settings.numberFormat}
          onChange={(value) => onUpdate({ numberFormat: value })}
          options={numberFormatOptions}
        />
      </Field>
    </TabsContent>
  )
}
