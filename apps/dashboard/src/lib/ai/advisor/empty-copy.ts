import type { AdvisorErrorCode } from '@chm/query-advisor-core'

import {
  ADVISOR_NO_TARGET_TABLE_MESSAGE,
  isAdvisorUserInputError,
} from '@chm/query-advisor-core'

export interface AdvisorEmptyCopy {
  title: string
  description: string
}

export function advisorUserInputCopy(
  code: Exclude<AdvisorErrorCode, 'schema_unavailable'>,
  message: string
): AdvisorEmptyCopy {
  switch (code) {
    case 'no_target_table':
      return {
        title: 'Needs a table to analyze',
        description: ADVISOR_NO_TARGET_TABLE_MESSAGE,
      }
    case 'invalid_sql':
      return {
        title: 'Query cannot be analyzed',
        description: message,
      }
    case 'query_not_found':
      return {
        title: 'Query not found',
        description: message,
      }
    case 'missing_input':
      return {
        title: 'Nothing to analyze',
        description: message,
      }
    default: {
      const _exhaustive: never = code
      return _exhaustive
    }
  }
}

export { isAdvisorUserInputError }
