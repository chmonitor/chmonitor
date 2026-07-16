import { describe, expect, mock, test } from 'bun:test'

// Mock the live ClickHouse query used by probeHostTopology.
let queryConnectionImpl: (...args: unknown[]) => Promise<unknown> =
  async () => ({
    data: [],
  })
mock.module('@/lib/connection-query/connection-client', () => ({
  queryConnection: (...args: unknown[]) => queryConnectionImpl(...args),
}))

const {
  computeHostWeights,
  probeHostTopology,
  PRIMARY_HOST_WEIGHT,
  REPLICA_HOST_WEIGHT,
  STANDALONE_TOPOLOGY,
} = await import('./replica-detection')

describe('computeHostWeights', () => {
  test('standalone hosts (no cluster) are always a full host', () => {
    const weights = computeHostWeights([
      STANDALONE_TOPOLOGY,
      STANDALONE_TOPOLOGY,
      STANDALONE_TOPOLOGY,
    ])
    expect(weights).toEqual([1, 1, 1])
  })

  test('the first host in a shard is full, later ones in the same shard are replicas', () => {
    const weights = computeHostWeights([
      { cluster: 'prod', shardNum: 1 },
      { cluster: 'prod', shardNum: 1 },
      { cluster: 'prod', shardNum: 1 },
    ])
    expect(weights).toEqual([
      PRIMARY_HOST_WEIGHT,
      REPLICA_HOST_WEIGHT,
      REPLICA_HOST_WEIGHT,
    ])
  })

  test('different shards of the same cluster are each a full host', () => {
    const weights = computeHostWeights([
      { cluster: 'prod', shardNum: 1 },
      { cluster: 'prod', shardNum: 2 },
    ])
    expect(weights).toEqual([1, 1])
  })

  test('different clusters never count as replicas of each other', () => {
    const weights = computeHostWeights([
      { cluster: 'prod', shardNum: 1 },
      { cluster: 'staging', shardNum: 1 },
    ])
    expect(weights).toEqual([1, 1])
  })

  test('mixed standalone + replicated hosts', () => {
    const weights = computeHostWeights([
      STANDALONE_TOPOLOGY,
      { cluster: 'prod', shardNum: 1 },
      { cluster: 'prod', shardNum: 1 },
    ])
    expect(weights).toEqual([1, 1, REPLICA_HOST_WEIGHT])
  })
})

describe('probeHostTopology', () => {
  const credentials = {
    host: 'https://ch.example.com',
    user: 'x',
    password: 'y',
  }

  test('reads cluster + shard_num from system.clusters', async () => {
    queryConnectionImpl = async () => ({
      data: [{ cluster: 'prod', shard_num: 2 }],
    })
    const topology = await probeHostTopology(credentials)
    expect(topology).toEqual({ cluster: 'prod', shardNum: 2 })
  })

  test('returns standalone when the host has no cluster rows', async () => {
    queryConnectionImpl = async () => ({ data: [] })
    const topology = await probeHostTopology(credentials)
    expect(topology).toEqual(STANDALONE_TOPOLOGY)
  })

  test('fails safe to standalone when the probe throws', async () => {
    queryConnectionImpl = async () => {
      throw new Error('connection refused')
    }
    const topology = await probeHostTopology(credentials)
    expect(topology).toEqual(STANDALONE_TOPOLOGY)
  })
})
