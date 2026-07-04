/**
 * widget-text — renders `props.markdown` as markdown, reusing the same
 * `react-markdown` + `remark-gfm` combination already used elsewhere in the
 * app (e.g. `TableClient`'s guidance banner, the assistant-ui chat thread).
 */

import type { DashboardWidget } from '@/types/dashboard-layout'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function WidgetText({ widget }: { widget: DashboardWidget }) {
  const markdown =
    typeof widget.props?.markdown === 'string' ? widget.props.markdown : ''

  if (!markdown.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
        Empty text widget.
      </div>
    )
  }

  // No typography plugin in this project (see `table-client.tsx`'s
  // `GuidanceMarkdown` for the same pattern) — style markdown elements with
  // plain utility classes via `[&_x]` selectors instead of a `prose` class.
  return (
    <div className="h-full overflow-auto text-[13px] leading-normal text-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  )
}
