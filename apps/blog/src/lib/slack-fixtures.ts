/**
 * The Slack demo scenes (src/data/slack-fixtures.json). The JSON is written by
 * apps/dashboard/scripts/gen-slack-fixtures.ts from the real alert builders;
 * tests/repo/slack-fixtures-sync.test.ts keeps it current. Edit the generator,
 * never the JSON.
 */

import raw from '../data/slack-fixtures.json'
import {
  type DataVisualizationBlock,
  validateDataVisualization,
} from './slack-chart-block'

export interface SlackTextObject {
  type: 'mrkdwn' | 'plain_text'
  text: string
  emoji?: boolean
}

export interface SlackButton {
  type: 'button'
  text: SlackTextObject
  style?: 'primary' | 'danger'
}

export type SlackBlock =
  | { type: 'section'; text: SlackTextObject }
  | { type: 'header'; text: SlackTextObject }
  | { type: 'context'; elements: SlackTextObject[] }
  | { type: 'actions'; elements: SlackButton[] }
  | { type: 'divider' }
  | DataVisualizationBlock

export interface SlackAttachment {
  color: string
  fallback?: string
  blocks: SlackBlock[]
}

export interface SlackMessageBody {
  text?: string
  blocks?: SlackBlock[]
  attachments?: SlackAttachment[]
}

export interface DemoMessage {
  author: 'webhook' | 'bot'
  ts: string
  edited?: boolean
  body: SlackMessageBody
  reactions?: { name: string; count: number }[]
}

export interface DemoThread {
  parent: DemoMessage
  replies: DemoMessage[]
}

export type DemoAuthor = { name: string; iconEmoji?: string }

export interface SlackDemo {
  channel: string
  authors: Record<DemoMessage['author'], DemoAuthor>
  users: Record<string, string>
  threads: Record<
    'webhook' | 'newAlert' | 'escalation' | 'ack' | 'resolved',
    DemoThread
  >
}

/** Each block type the components draw, with every field they read. */
const BLOCK_FIELDS: Record<string, string[]> = {
  section: ['type', 'text', 'block_id'],
  header: ['type', 'text', 'block_id'],
  context: ['type', 'elements', 'block_id'],
  actions: ['type', 'elements', 'block_id'],
  divider: ['type', 'block_id'],
  data_visualization: ['type', 'title', 'chart', 'block_id'],
}
/** Slack's limit on data_visualization blocks in one message. */
const MAX_CHARTS = 2
const ATTACHMENT_FIELDS = ['color', 'fallback', 'blocks']

function unknownFields(value: object, known: string[]): string[] {
  return Object.keys(value).filter((k) => !known.includes(k))
}

/**
 * Check the scenes against what the Slack components can draw, so a block
 * type or field the builders start sending fails the build instead of
 * vanishing from the page.
 */
export function parseSlackDemo(data: unknown): SlackDemo {
  const demo = data as SlackDemo
  const messages = Object.values(demo.threads).flatMap((t) => [
    t.parent,
    ...t.replies,
  ])
  for (const { body } of messages) {
    const attachments = body.attachments ?? []
    for (const a of attachments) {
      const extra = unknownFields(a, ATTACHMENT_FIELDS)
      if (extra.length > 0) {
        throw new Error(
          `Slack demo: attachment field "${extra[0]}" is not drawn`
        )
      }
      if (!/^#[0-9a-f]{6}$/i.test(a.color)) {
        throw new Error(
          `Slack demo: attachment colour "${a.color}" is not #rrggbb`
        )
      }
    }
    const blocks = [
      ...(body.blocks ?? []),
      ...attachments.flatMap((a) => a.blocks),
    ]
    for (const block of blocks) {
      const fields = BLOCK_FIELDS[block.type]
      if (!fields) {
        throw new Error(
          `Slack demo: no renderer for block type "${block.type}"`
        )
      }
      const extra = unknownFields(block, fields)
      if (extra.length > 0) {
        throw new Error(
          `Slack demo: ${block.type} field "${extra[0]}" is not drawn`
        )
      }
      if (
        block.type === 'actions' &&
        block.elements.some((e) => e.type !== 'button')
      ) {
        throw new Error('Slack demo: actions blocks may only hold buttons')
      }
      if (block.type === 'data_visualization') validateDataVisualization(block)
    }
    const charts = blocks.filter((b) => b.type === 'data_visualization').length
    if (charts > MAX_CHARTS) {
      throw new Error(
        `Slack demo: a message has ${charts} data_visualization blocks, Slack allows ${MAX_CHARTS}`
      )
    }
  }
  return demo
}

/**
 * The first series of the message's first line, area or bar chart. Throws
 * when there is none, so a page that quotes the chart cannot build without it.
 */
export function firstChartSeries(message: DemoMessage): number[] {
  const { blocks = [], attachments = [] } = message.body
  const chart = [...blocks, ...attachments.flatMap((a) => a.blocks)].find(
    (b): b is DataVisualizationBlock => b.type === 'data_visualization'
  )?.chart
  if (!chart || chart.type === 'pie') {
    throw new Error('Slack demo: the message has no line, area or bar chart')
  }
  return chart.series[0].data.map((p) => p.value)
}

export const slackDemo = parseSlackDemo(raw)
