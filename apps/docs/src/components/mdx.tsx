import type { MDXComponents } from 'mdx/types'

import * as Twoslash from 'fumadocs-twoslash/ui'
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { Badge } from '@/components/mdx/badge'
import { ConfigTab, ConfigTabs } from '@/components/mdx/config-tabs'
import { FeatureCard } from '@/components/mdx/feature-card'
import { GrantBuilder } from '@/components/mdx/grant-builder'
import { ImageRow } from '@/components/mdx/image-row'
import { Mermaid } from '@/components/mdx/mermaid'
import { Screenshot } from '@/components/mdx/screenshot'

// Components made globally available to every MDX page (no per-file imports).
// `defaultMdxComponents` already provides Card, Cards, Callout, Tabs, and code
// blocks; we add the structural/diagram components used across the docs.
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    Step,
    Steps,
    Tab,
    Tabs,
    File,
    Files,
    Folder,
    TypeTable,
    // GrantBuilder: interactive permission-level picker on the CH requirements page.
    GrantBuilder,
    // Mermaid: renders ```mermaid fenced blocks and <Mermaid chart=…/> as SVG.
    Mermaid,
    // Presentational blocks styled to match the blog: framed light/dark
    // screenshots with zoom, image rows, synced config tabs, cards, badges.
    Screenshot,
    ImageRow,
    ConfigTabs,
    ConfigTab,
    FeatureCard,
    Badge,
    // Twoslash UI: renders TypeScript hover popups for ```ts twoslash blocks.
    ...Twoslash,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
