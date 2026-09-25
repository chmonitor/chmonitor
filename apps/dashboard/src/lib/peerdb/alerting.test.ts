import {
  auditPeerDBAlert,
  boundStatusText,
  buildPeerDBAlertPayload,
  classifyPeerDBMirror,
  formatPeerDBAlertMessage,
  investigatePeerDBAlert,
  peerDBDedupKey,
  peerDBPayloadValue,
  shouldDeliverPeerDBAlert,
  validatePeerDBAlertMessage,
} from './alerting'
import { describe, expect, test } from 'bun:test'

describe('classifyPeerDBMirror', () => {
  test('ok when running with no signals', () => {
    const c = classifyPeerDBMirror({
      flowName: 'pg_to_ch',
      status: 'STATUS_RUNNING',
    })
    expect(c.severity).toBe('ok')
  })

  test('error on STATUS_FAILED regardless of numbers', () => {
    const c = classifyPeerDBMirror({
      flowName: 'pg_to_ch',
      status: 'STATUS_FAILED',
    })
    expect(c.severity).toBe('error')
    expect(c.reasons).toContain('status:STATUS_FAILED')
  })

  test('error when errorMessage present', () => {
    const c = classifyPeerDBMirror({
      flowName: 'm',
      status: 'STATUS_RUNNING',
      errorMessage: 'connection refused',
    })
    expect(c.severity).toBe('error')
    expect(c.reasons).toContain('error-message-present')
  })

  test('error on CDC lag at/above error threshold', () => {
    const c = classifyPeerDBMirror(
      { flowName: 'm', status: 'STATUS_RUNNING', lagSec: 3600 },
      {
        lagWarnSec: 300,
        lagErrorSec: 1800,
        slotLagWarnMb: 512,
        slotLagErrorMb: 2048,
        errorWarnCount: 1,
        errorErrorCount: 5,
      }
    )
    expect(c.severity).toBe('error')
    expect(c.reasons).toContain('cdc-lag-error')
  })

  test('warning on CDC lag at/above warn threshold', () => {
    const c = classifyPeerDBMirror({ flowName: 'm', lagSec: 600 })
    expect(c.severity).toBe('warning')
    expect(c.reasons).toContain('cdc-lag-warning')
  })

  test('warning on paused status', () => {
    const c = classifyPeerDBMirror({ flowName: 'm', status: 'STATUS_PAUSED' })
    expect(c.severity).toBe('warning')
  })

  test('unavailable error count never classifies on its own', () => {
    const c = classifyPeerDBMirror({
      flowName: 'm',
      status: 'STATUS_RUNNING',
      recentErrorCount: 0,
      errorCountSource: 'unavailable',
    })
    expect(c.severity).toBe('ok')
    expect(c.reasons).toContain('error-count-unavailable')
  })

  test('error-count thresholds escalate', () => {
    expect(
      classifyPeerDBMirror({ flowName: 'm', recentErrorCount: 7 }).severity
    ).toBe('error')
    expect(
      classifyPeerDBMirror({ flowName: 'm', recentErrorCount: 2 }).severity
    ).toBe('warning')
  })
})

describe('formatPeerDBAlertMessage', () => {
  test('formats title/text/label with severity prefix', () => {
    const signal = {
      flowName: 'pg_to_ch',
      status: 'STATUS_FAILED',
      errorMessage: 'wal reader crashed',
      lagSec: 45,
      recentErrorCount: 3,
    }
    const classification = classifyPeerDBMirror(signal)
    const msg = formatPeerDBAlertMessage(signal, classification)
    expect(msg.title).toBe('[ERROR] PeerDB mirror pg_to_ch')
    expect(msg.text).toContain('[ERROR]')
    expect(msg.text).toContain('wal reader crashed')
    expect(msg.label).toContain('STATUS_FAILED')
    expect(msg.label).toContain('3 recent errors')
  })

  test('says "error count unavailable" instead of "0 errors"', () => {
    const signal = {
      flowName: 'm',
      status: 'STATUS_RUNNING',
      lagSec: 600,
      errorCountSource: 'unavailable' as const,
    }
    const msg = formatPeerDBAlertMessage(signal, classifyPeerDBMirror(signal))
    expect(msg.label).toContain('error count unavailable')
    expect(msg.label).not.toContain('0 recent errors')
  })

  test('truncates long error snippets to one line', () => {
    const msg = formatPeerDBAlertMessage(
      {
        flowName: 'm',
        status: 'STATUS_FAILED',
        errorMessage: `a\nb\n${'x'.repeat(500)}`,
      },
      { severity: 'error', reasons: [] }
    )
    expect(msg.text).not.toContain('\n')
    expect(msg.text.length).toBeLessThan(2000)
  })
})

describe('validatePeerDBAlertMessage', () => {
  test('accepts a well-formed message', () => {
    const v = validatePeerDBAlertMessage({
      title: '[ERROR] PeerDB mirror m',
      text: '[ERROR] PeerDB mirror m — STATUS_FAILED',
      label: 'STATUS_FAILED',
    })
    expect(v.ok).toBe(true)
  })

  test('flags missing severity prefix and secret leakage', () => {
    const v = validatePeerDBAlertMessage({
      title: 'mirror broke password=hunter2',
      text: 'token abc',
      label: '',
    })
    expect(v.ok).toBe(false)
    expect(v.issues).toContain('title-missing-severity-prefix')
    expect(v.issues).toContain('label-empty')
    expect(v.issues).toContain('possible-secret-leak')
  })
})

describe('buildPeerDBAlertPayload', () => {
  test('maps error to critical with shared contract fields', () => {
    const signal = { flowName: 'm', status: 'STATUS_FAILED', lagSec: 10 }
    const classification = classifyPeerDBMirror(signal)
    const message = formatPeerDBAlertMessage(signal, classification)
    const payload = buildPeerDBAlertPayload({ signal, classification, message })
    expect(payload.severity).toBe('critical')
    expect(payload.metric).toBe('peerdb-mirror-health')
    expect(payload.hostLabel).toBe('peerdb:m')
  })
})

describe('auditPeerDBAlert', () => {
  test('never throws without a D1 binding', async () => {
    await expect(
      auditPeerDBAlert({ flowName: 'm', severity: 'error', delivered: false })
    ).resolves.toBeUndefined()
  })
})

describe('investigatePeerDBAlert', () => {
  const base = {
    signal: { flowName: 'm', status: 'STATUS_FAILED' as const },
    classification: {
      severity: 'error' as const,
      reasons: ['status:STATUS_FAILED'],
    },
    message: {
      title: '[ERROR] PeerDB mirror m',
      text: '[ERROR] PeerDB mirror m — STATUS_FAILED',
      label: 'STATUS_FAILED',
    },
  }

  test('send verdict when metrics + message check out', () => {
    const inv = investigatePeerDBAlert({
      ...base,
      metrics: {
        signalsCollected: 3,
        hasLagSample: true,
        hasErrorSample: true,
        hasSlotSample: false,
      },
    })
    expect(inv.verdict).toBe('send')
  })

  test('hold when no signals collected (refuse to send blind)', () => {
    const inv = investigatePeerDBAlert({
      ...base,
      metrics: {
        signalsCollected: 0,
        hasLagSample: false,
        hasErrorSample: false,
        hasSlotSample: false,
      },
    })
    expect(inv.verdict).toBe('hold')
  })

  test('hold on ok classification', () => {
    const inv = investigatePeerDBAlert({
      signal: { flowName: 'm', status: 'STATUS_RUNNING' },
      classification: { severity: 'ok', reasons: [] },
      message: {
        title: '[OK] PeerDB mirror m',
        text: '[OK] PeerDB mirror m — STATUS_RUNNING',
        label: 'STATUS_RUNNING',
      },
      metrics: {
        signalsCollected: 2,
        hasLagSample: true,
        hasErrorSample: true,
        hasSlotSample: true,
      },
    })
    expect(inv.verdict).toBe('hold')
  })
})

describe('shouldDeliverPeerDBAlert', () => {
  const validation = { ok: true, issues: [] as string[] }
  const investigation = {
    investigatedAt: new Date(0).toISOString(),
    verdict: 'send' as const,
    checks: [],
    notes: [],
  }

  test('dry-run default holds delivery', () => {
    const d = shouldDeliverPeerDBAlert({
      severity: 'error',
      validation,
      investigation,
      dedupKey: 'k1',
      seen: new Set(),
    })
    expect(d.deliver).toBe(false)
    expect(d.reason).toBe('dry-run')
  })

  test('delivers when dryRun false, valid, investigated, unseen', () => {
    const d = shouldDeliverPeerDBAlert({
      severity: 'error',
      validation,
      investigation,
      dedupKey: 'k2',
      seen: new Set(),
      dryRun: false,
    })
    expect(d.deliver).toBe(true)
  })

  test('holds on duplicate dedup key', () => {
    const d = shouldDeliverPeerDBAlert({
      severity: 'error',
      validation,
      investigation,
      dedupKey: 'k3',
      seen: new Set(['k3']),
      dryRun: false,
    })
    expect(d.deliver).toBe(false)
    expect(d.reason).toBe('duplicate')
  })

  test('holds on investigation hold', () => {
    const d = shouldDeliverPeerDBAlert({
      severity: 'error',
      validation,
      investigation: { ...investigation, verdict: 'hold' },
      dedupKey: 'k4',
      seen: new Set(),
      dryRun: false,
    })
    expect(d.deliver).toBe(false)
    expect(d.reason).toBe('investigation-hold')
  })

  test('dedup keys are stable within the hour bucket', () => {
    const now = Date.now()
    expect(peerDBDedupKey({ flowName: 'M', severity: 'error', now })).toBe(
      peerDBDedupKey({ flowName: 'm', severity: 'error', now })
    )
  })
})

describe('boundStatusText', () => {
  test('passes STATUS_* enum spellings through', () => {
    expect(boundStatusText('STATUS_FAILED')).toBe('STATUS_FAILED')
  })

  test('falls back for empty, junk, or over-long input', () => {
    expect(boundStatusText(null)).toBe('status unknown')
    expect(boundStatusText('  ')).toBe('status unknown')
    expect(boundStatusText('something broke; DROP TABLE x')).toBe(
      'status unknown'
    )
    expect(boundStatusText(`STATUS_${'A'.repeat(50)}`)).toBe('status unknown')
  })
})

describe('validatePeerDBAlertMessage secret scan', () => {
  test('flags leakage in the label too, not just title/text', () => {
    const v = validatePeerDBAlertMessage({
      title: '[WARNING] PeerDB mirror m',
      text: '[WARNING] PeerDB mirror m — lag 5m',
      label: 'api_token=abc123',
    })
    expect(v.ok).toBe(false)
    expect(v.issues).toContain('possible-secret-leak')
  })
})

describe('peerDBPayloadValue', () => {
  test('lag-fired alert carries lag seconds against lag thresholds', () => {
    const signal = { flowName: 'm', status: 'STATUS_RUNNING', lagSec: 600 }
    const v = peerDBPayloadValue(signal, classifyPeerDBMirror(signal))
    expect(v.value).toBe(600)
    expect(v.warnThreshold).toBe(300)
    expect(v.critThreshold).toBe(1800)
  })

  test('error-count firing carries the count against count thresholds', () => {
    const signal = { flowName: 'm', recentErrorCount: 7 }
    const v = peerDBPayloadValue(signal, classifyPeerDBMirror(signal))
    expect(v.value).toBe(7)
    expect(v.warnThreshold).toBe(1)
    expect(v.critThreshold).toBe(5)
  })

  test('slot-lag firing carries slot MB against slot thresholds', () => {
    const signal = { flowName: 'm', slotLagMb: 3000 }
    const v = peerDBPayloadValue(signal, classifyPeerDBMirror(signal))
    expect(v.value).toBe(3000)
    expect(v.warnThreshold).toBe(512)
    expect(v.critThreshold).toBe(2048)
  })

  test('status firing without a count falls back to 1 against count thresholds', () => {
    const signal = { flowName: 'm', status: 'STATUS_FAILED' }
    const v = peerDBPayloadValue(signal, classifyPeerDBMirror(signal))
    expect(v.value).toBe(1)
    expect(v.critThreshold).toBe(5)
  })
})
