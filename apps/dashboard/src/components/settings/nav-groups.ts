import { Binary, Clock, EyeOff, Globe, Palette, Rows3 } from 'lucide-react'

export const navGroups: {
  label: string
  items: { value: string; label: string; icon: typeof Clock }[]
}[] = [
  {
    label: 'Preferences',
    items: [
      { value: 'general', label: 'General', icon: Clock },
      { value: 'appearance', label: 'Appearance', icon: Palette },
    ],
  },
  {
    label: 'Display',
    items: [
      { value: 'units', label: 'Units', icon: Binary },
      { value: 'layout', label: 'Layout', icon: Rows3 },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { value: 'navigation', label: 'Navigation', icon: EyeOff },
      { value: 'integrations', label: 'Integrations', icon: Globe },
    ],
  },
]
