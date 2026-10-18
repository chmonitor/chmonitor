import { z } from 'zod'

import { dynamicTool } from 'ai'

const MAX_OPTIONS = 20
const MAX_TEXT_LEN = 200

export function createAskUserTools() {
  return {
    ask_user: dynamicTool({
      description: `Ask the user a question to gather information needed for analysis. Use this tool when you need clarification, user preferences, or structured input before proceeding. Supports multiple input types:
- single_choice: Present options for the user to pick one (e.g., "Which database?", "What time range?")
- multi_choice: Checkboxes for selecting multiple items (e.g., "Which metrics to include?")
- confirm: Yes/no confirmation with context (e.g., "Analyze all 5 slow queries or just the top one?")
- free_text: Open-ended text input (e.g., "Describe the symptoms you're seeing")
- rating: Numeric scale (e.g., "Rate the usefulness of this analysis 1-5")`,
      inputSchema: z
        .object({
          question: z
            .string()
            .min(1)
            .max(MAX_TEXT_LEN)
            .describe('The question to ask the user'),
          inputType: z
            .enum([
              'single_choice',
              'multi_choice',
              'confirm',
              'free_text',
              'rating',
            ])
            .describe('Type of input widget to show'),
          options: z
            .array(
              z.object({
                label: z.string().min(1).max(80).describe('Display label'),
                value: z
                  .string()
                  .min(1)
                  .max(120)
                  .describe('Value to return when selected'),
                description: z
                  .string()
                  .max(MAX_TEXT_LEN)
                  .optional()
                  .describe('Optional description/hint'),
              })
            )
            .max(MAX_OPTIONS)
            .optional()
            .describe('Options for single_choice and multi_choice types'),
          placeholder: z
            .string()
            .max(MAX_TEXT_LEN)
            .optional()
            .describe('Placeholder text for free_text input'),
          min: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe('Minimum value for rating (default: 1)'),
          max: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe('Maximum value for rating (default: 5)'),
          context: z
            .string()
            .max(MAX_TEXT_LEN)
            .optional()
            .describe('Additional context shown above the question'),
        })
        .refine(
          (data) => {
            if (data.min !== undefined && data.max !== undefined) {
              return data.max >= data.min
            }
            return true
          },
          {
            message:
              'Maximum rating value must be greater than or equal to minimum rating value',
          }
        ),
      execute: async (input: unknown) => {
        const params = input as {
          question: string
          inputType:
            | 'single_choice'
            | 'multi_choice'
            | 'confirm'
            | 'free_text'
            | 'rating'
          options?: Array<{
            label: string
            value: string
            description?: string
          }>
          placeholder?: string
          min?: number
          max?: number
          context?: string
        }

        // Return the structured question — the UI renders this as an interactive widget.
        // The user's response will be provided as the tool result.
        return {
          type: 'ask_user',
          question: params.question,
          inputType: params.inputType,
          options: params.options,
          placeholder: params.placeholder,
          min: params.min ?? 1,
          max: params.max ?? 5,
          context: params.context,
          awaiting_response: true,
        }
      },
    }),
  }
}
