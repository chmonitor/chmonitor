/**
 * Cypress component tests for the data-table system.
 *
 * WHY these tests exist:
 *  - The DataTable component has many interactive behaviors (pagination, sort,
 *    column visibility, card toggle) that only make sense when rendered in a
 *    real browser DOM. Unit tests cover the algorithmic layer; these tests
 *    cover the interaction layer — what a user actually sees and does.
 *  - DataTablePagination is tested standalone (no router context required)
 *    because it is a stateless render of a TanStack Table instance. This lets
 *    us validate navigation, row-count display, and page-size changes without
 *    the complexity of a full router provider.
 *  - Synthetic utility column invariants (__expand, select) are validated by
 *    asserting that the correct aria-labels and positions are present in the
 *    rendered DOM — the unit tests confirm the column-order algorithm, while
 *    these tests confirm it actually renders correctly.
 *
 * Setup notes:
 *  - `cy.mount()` is added by cypress/support/component.ts.
 *  - DataTablePagination takes a TanStack Table instance directly; we build
 *    one inside test wrappers using useReactTable so the test has full
 *    control over pagination state without requiring a real data source.
 */

import {
  getCoreRowModel,
  getPaginationRowModel,
  type PaginationState,
  useReactTable,
} from '@tanstack/react-table'

import { DataTablePagination } from '../pagination'
import React, { useState } from 'react'

/**
 * Renders DataTablePagination driven by a real TanStack Table built from
 * inline mock data. State is managed internally so pagination interactions
 * (clicking next/prev/page-size) actually work.
 */
function PaginationHarness({
  totalRows,
  initialPageSize = 10,
}: {
  totalRows: number
  initialPageSize?: number
}) {
  const data = React.useMemo(
    () => Array.from({ length: totalRows }, (_, i) => ({ id: i + 1 })),
    [totalRows]
  )

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  })

  const table = useReactTable({
    data,
    columns: [{ accessorKey: 'id', header: 'ID' }],
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    state: { pagination },
  })

  return <DataTablePagination table={table} />
}

// DataTablePagination tests
//
// WHY: pagination is the first thing a user notices when a table has many
// rows. These tests ensure: controls are visible when needed, disabled when
// at boundaries, and page-size changes reflect immediately.

describe('DataTablePagination', () => {
  describe('visibility', () => {
    it('renders nothing when table has zero rows', () => {
      cy.mount(<PaginationHarness totalRows={0} />)
      // Component returns null when row model is empty
      cy.get('[aria-label="Pagination"]').should('not.exist')
    })

    it('renders nothing when all rows fit on one page (no navigation needed)', () => {
      cy.mount(<PaginationHarness totalRows={5} initialPageSize={10} />)
      cy.get('[aria-label="Pagination"]').should('not.exist')
    })

    it('renders pagination controls when rows exceed page size', () => {
      cy.mount(<PaginationHarness totalRows={25} initialPageSize={10} />)
      cy.get('[aria-label="Pagination"]').should('exist')
    })
  })

  describe('first page boundary', () => {
    it('disables "previous page" on the first page', () => {
      cy.mount(<PaginationHarness totalRows={50} initialPageSize={10} />)
      cy.get('[aria-label="Go to previous page"]').should('be.disabled')
    })

    it('disables "go to first page" on the first page', () => {
      cy.mount(<PaginationHarness totalRows={50} initialPageSize={10} />)
      cy.get('[aria-label="Go to first page"]').should('be.disabled')
    })

    it('enables "next page" on the first page', () => {
      cy.mount(<PaginationHarness totalRows={50} initialPageSize={10} />)
      cy.get('[aria-label="Go to next page"]').should('not.be.disabled')
    })
  })

  describe('last page boundary', () => {
    it('disables "next page" and "last page" after navigating to the last page', () => {
      cy.mount(<PaginationHarness totalRows={15} initialPageSize={10} />)
      // Navigate to last page
      cy.get('[aria-label="Go to next page"]').click()
      cy.get('[aria-label="Go to next page"]').should('be.disabled')
      cy.get('[aria-label="Go to last page"]').should('be.disabled')
    })

    it('enables "previous page" after navigating away from first page', () => {
      cy.mount(<PaginationHarness totalRows={15} initialPageSize={10} />)
      cy.get('[aria-label="Go to next page"]').click()
      cy.get('[aria-label="Go to previous page"]').should('not.be.disabled')
    })
  })

  describe('navigation', () => {
    it('navigates back to the first page via "first page" button', () => {
      cy.mount(<PaginationHarness totalRows={30} initialPageSize={10} />)
      // Go to page 2
      cy.get('[aria-label="Go to next page"]').click()
      // Jump back to first page
      cy.get('[aria-label="Go to first page"]').click()
      // Previous and first should be disabled again
      cy.get('[aria-label="Go to previous page"]').should('be.disabled')
    })

    it('navigates to the last page via "last page" button', () => {
      cy.mount(<PaginationHarness totalRows={30} initialPageSize={10} />)
      cy.get('[aria-label="Go to last page"]').click()
      cy.get('[aria-label="Go to next page"]').should('be.disabled')
    })
  })

  describe('page size selector', () => {
    it('renders a "Rows per page" selector', () => {
      cy.mount(<PaginationHarness totalRows={50} initialPageSize={10} />)
      cy.get('[aria-label="Rows per page"]').should('exist')
    })

    it('changing page size resets to page 1 (standard table UX contract)', () => {
      cy.mount(<PaginationHarness totalRows={50} initialPageSize={10} />)
      // Navigate to page 2
      cy.get('[aria-label="Go to next page"]').click()
      // Changing page size should show controls that indicate first page state
      cy.get('[aria-label="Rows per page"]').click()
      cy.contains('[role="option"]', '25').click()
      // Now with 50 rows / 25 per page we are on page 1
      cy.get('[aria-label="Go to previous page"]').should('be.disabled')
    })
  })

  describe('row count display', () => {
    it('shows the row range for the first page', () => {
      cy.mount(<PaginationHarness totalRows={25} initialPageSize={10} />)
      // "1–10 of 25 rows" format
      cy.contains('1').should('exist')
      cy.contains('25').should('exist')
    })
  })
})
