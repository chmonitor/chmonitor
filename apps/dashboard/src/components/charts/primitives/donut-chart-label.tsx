export interface DonutChartLabelProps {
  viewBox?: any
  total: number
  centerLabel?: string
  formatValue: (value: number) => string
}

export function DonutChartLabel({
  viewBox,
  total,
  centerLabel,
  formatValue,
}: DonutChartLabelProps) {
  if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) {
    return null
  }

  // Convert string to number if needed
  const cx =
    typeof viewBox.cx === 'string' ? parseFloat(viewBox.cx) : (viewBox.cx ?? 0)
  const cy =
    typeof viewBox.cy === 'string' ? parseFloat(viewBox.cy) : (viewBox.cy ?? 0)

  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan x={cx} y={cy} className="fill-foreground text-3xl font-bold">
        {centerLabel || formatValue(total)}
      </tspan>
      <tspan x={cx} y={cy + 24} className="fill-muted-foreground">
        {centerLabel ? formatValue(total) : 'Total'}
      </tspan>
    </text>
  )
}
