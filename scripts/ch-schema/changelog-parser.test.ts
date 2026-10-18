import { parseChangelog } from './changelog-parser'
import { describe, expect, test } from 'bun:test'

const body = (n: string) =>
  `\n#### Improvement\n* Added column \`foo\` to \`system.query_log\`. [#${n}](x).\n`

describe('parseChangelog heading formats', () => {
  test('parses the current upstream heading (level 3, anchor, no v, LTS)', () => {
    const md = `### <a id="269"></a> ClickHouse release 26.9, 2026-09-21. [Presentation](u)\n${body('1')}\n### <a id="268"></a> ClickHouse release 26.8 LTS, 2026-08-27. [Video](u)\n${body('2')}`
    const entries = parseChangelog(md)
    expect(entries.map((e) => e.version)).toEqual(['26.9', '26.8'])
    expect(entries[0].releaseDate).toBe('2026-09-21')
    expect(entries[1].isLTS).toBe(true)
  })

  test('still parses the legacy heading', () => {
    const md = `## ClickHouse release v24.1.1.2048, 2024-01-30\n${body('3')}`
    expect(parseChangelog(md).map((e) => e.version)).toEqual(['24.1'])
  })
})
