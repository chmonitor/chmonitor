/**
 * Parse ClickHouse EXPLAIN text output into a nested tree.
 *
 * EXPLAIN PLAN and EXPLAIN PIPELINE return a hierarchical structure encoded as
 * plain text with leading-space indentation, e.g.:
 *
 *   Expression ((Project names + Projection))
 *     Aggregating
 *       Expression (Before GROUP BY)
 *         ReadFromMergeTree (default.hits)
 *
 * Each increase in leading-space width is a deeper level. This converts the
 * flat list of lines into a tree of {label, children} nodes by tracking
 * indentation depth on a stack. Lines that ClickHouse prefixes with structural
 * characters (e.g. PIPELINE's "(NodeName)") still nest purely by indentation,
 * so the same algorithm handles both modes.
 */

export interface ExplainTreeNode {
  /** Stable id for React keys / expand-collapse state (path-based). */
  id: string
  /** Trimmed text content of the line. */
  label: string
  /** Original leading-space width, kept for debugging / tooltips. */
  indent: number
  children: ExplainTreeNode[]
}

function leadingIndent(line: string): number {
  let count = 0
  for (const ch of line) {
    if (ch === ' ') count += 1
    else if (ch === '\t') count += 2
    else break
  }
  return count
}

/**
 * Build a tree from EXPLAIN text lines.
 *
 * Returns the list of root nodes. Lines that are blank after trimming are
 * skipped. If every line is at the same (zero) indent the result is a flat
 * list of roots — the renderer treats that as a degenerate tree and the Text
 * view remains the better choice, but the tree still renders correctly.
 */
export function parseExplainTree(lines: string[]): ExplainTreeNode[] {
  const roots: ExplainTreeNode[] = []
  // Stack of {node, indent} for ancestors of the current line.
  const stack: { node: ExplainTreeNode; indent: number }[] = []
  let counter = 0

  for (const raw of lines) {
    if (raw.trim().length === 0) continue

    const indent = leadingIndent(raw)
    const label = raw.trim()
    const node: ExplainTreeNode = {
      id: `n${counter++}`,
      label,
      indent,
      children: [],
    }

    // Pop ancestors that are not shallower than the current line.
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, indent })
  }

  return roots
}

export function countNodes(nodes: ExplainTreeNode[]): number {
  let total = 0
  for (const n of nodes) {
    total += 1 + countNodes(n.children)
  }
  return total
}
