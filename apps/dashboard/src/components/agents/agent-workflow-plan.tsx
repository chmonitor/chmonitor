import {
  CheckCircle2Icon,
  CircleDashedIcon,
  ListChecksIcon,
  Loader2Icon,
} from 'lucide-react'

import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export type WorkflowPlanStepStatus = 'pending' | 'in_progress' | 'completed'

export interface WorkflowPlanStep {
  id: number
  title: string
  status: WorkflowPlanStepStatus
}

export interface AgentWorkflowPlanProps {
  steps: WorkflowPlanStep[]
  note?: string
  /** Workflow title shown when the plan was started from a template. */
  workflow?: string
  total?: number
  completed?: number
}

function StepIcon({ status }: { status: WorkflowPlanStepStatus }) {
  if (status === 'completed') {
    return (
      <CheckCircle2Icon className="size-4 shrink-0 text-[var(--chart-green)]" />
    )
  }
  if (status === 'in_progress') {
    return (
      <Loader2Icon className="size-4 shrink-0 animate-spin text-[var(--chart-yellow)]" />
    )
  }
  return <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
}

/**
 * Renders the agent's live workflow plan (the output of the `update_plan` tool).
 *
 * Shows each step with a status icon, strikes through completed steps, and
 * highlights the step currently in progress — giving the user a transparent view
 * of where the agent is in its multi-step investigation harness.
 */
export function AgentWorkflowPlan({
  steps,
  note,
  workflow,
  total,
  completed,
}: AgentWorkflowPlanProps) {
  if (!Array.isArray(steps) || steps.length === 0) return null

  const totalCount = total ?? steps.length
  const completedCount =
    completed ?? steps.filter((step) => step.status === 'completed').length
  const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <ListChecksIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
          {workflow ? `Workflow: ${workflow}` : 'Workflow plan'}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {completedCount}/{totalCount}
        </span>
      </div>

      <Progress
        value={pct}
        aria-label="Workflow progress"
        className="mb-3 h-1.5"
      />

      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5">
              <StepIcon status={step.status} />
            </span>
            <span
              className={cn(
                'leading-snug',
                step.status === 'completed' &&
                  'text-muted-foreground line-through',
                step.status === 'in_progress' && 'font-medium text-foreground',
                step.status === 'pending' && 'text-muted-foreground'
              )}
            >
              {step.title}
            </span>
          </li>
        ))}
      </ol>

      {note ? (
        <p className="mt-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  )
}
