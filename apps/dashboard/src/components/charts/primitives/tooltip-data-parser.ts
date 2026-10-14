/**
 * Data parsing utilities for chart tooltips
 */

/**
 * Parse breakdown data into consistent [name, value] tuples
 *
 * Handles both array format: [('A', 1000)]
 * and object format: [{ name: 'A', value: 1000 }]
 */
export function parseBreakdownData(
  breakdownData: Array<any>,
  breakdownLabel?: string,
  breakdownValue?: string
): Array<[string, any]> {
  return breakdownData.map((item): [string, any] => {
    if (Array.isArray(item) && item.length === 2) {
      return item as [string, any]
    }

    if (typeof item === 'object') {
      if (!breakdownLabel || !breakdownValue) {
        throw new Error('Missing breakdownLabel or breakdownValue')
      }

      return [item[breakdownLabel], item[breakdownValue]]
    }

    throw new Error('Invalid breakdown data, expected array(2) or object')
  })
}
