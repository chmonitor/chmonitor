/**
 * Lazy icon resolution for declarative chart definitions.
 *
 * A declarative chart references its icon by a lucide-react icon name (a
 * plain, kebab-case string, e.g. `'cpu'`, `'memory-stick'`, `'database'`) —
 * not a live React component reference, so the catalog stays JSON-serializable
 * and community/AI-authored definitions never need to `import` anything.
 *
 * Resolution goes through lucide-react's own `lucide-react/dynamic` entry
 * point (`DynamicIcon` + `dynamicIconImports`), which code-splits every icon
 * behind its own `import()` keyed by name. Only icons a `ChartIcon` actually
 * renders are ever fetched — this module does NOT eagerly import the full
 * lucide-react icon set.
 */
import type { ComponentProps } from 'react'

import { DynamicIcon, iconNames } from 'lucide-react/dynamic'

export type { IconName as ChartIconName } from 'lucide-react/dynamic'

const KNOWN_ICON_NAMES = new Set<string>(iconNames)

/** True when `name` is a real lucide-react icon name (kebab-case). */
export function isKnownChartIconName(name: string): boolean {
  return KNOWN_ICON_NAMES.has(name)
}

export interface ChartIconProps
  extends Omit<ComponentProps<typeof DynamicIcon>, 'name'> {
  /** lucide-react icon name, e.g. 'cpu', 'memory-stick', 'database'. */
  name: string
}

/**
 * Renders a declarative chart's `icon` string via lucide-react's lazy
 * `DynamicIcon`. Unknown names fall through to `DynamicIcon`'s own
 * fallback (renders nothing) rather than throwing, so a stale/typo'd icon
 * degrades gracefully in a chart picker instead of crashing the page.
 */
export function ChartIcon({ name, ...props }: ChartIconProps) {
  return <DynamicIcon name={name as never} {...props} />
}
