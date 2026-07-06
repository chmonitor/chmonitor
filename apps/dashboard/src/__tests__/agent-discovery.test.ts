import { agentDiscoveryHandler, securityHeadersHandler } from '@/start'

import { describe, expect, test } from 'bun:test'

// Type definitions for agent discovery responses
interface LinkSetItem {
  anchor: string
  'service-doc'?: Array<{ href: string }>
  status?: Array<{ href: string }>
  rel?: string
  type?: string
  href?: string
}

interface LinkSetResponse {
  linkset: LinkSetItem[]
}

interface OpenAPIInfo {
  title: string
  version: string
}

interface OpenAPIResponse {
  openapi: string
  info: OpenAPIInfo
  paths: Record<string, unknown>
}

interface OAuthProtectedResource {
  resource: string
  authorization_servers: string[]
}

interface OAuthAuthorizationServer {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  response_types_supported: string[]
  agent_auth?: {
    skill: string
    register_uri: string
  }
}

interface OpenIDConfiguration {
  issuer: string
  jwks_uri: string
}

interface MCPServerCard {
  serverInfo: {
    name: string
    description: string
    version: string
  }
  endpoint: string
}

interface AgentSkillsDiscovery {
  $schema: string
  skills: Array<{
    url: string
    digest: string
  }>
}

describe('Agent Discovery Metadata Endpoints & Content Negotiation', () => {
  const nextMock = async () => {
    return { response: new Response('HTML content') }
  }

  test('HTML responses return markdown when Accept: text/markdown is passed', async () => {
    const request = new Request('https://example.com/overview', {
      headers: {
        Accept: 'text/markdown, text/html',
      },
    })
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')
    expect(res.headers.get('x-markdown-tokens')).toBeDefined()

    const body = await res.text()
    expect(body).toContain('# chmonitor')
    expect(body).toContain('API Catalog')
  })

  test('HTML responses return original HTML when Accept: text/markdown is absent', async () => {
    const request = new Request('https://example.com/overview', {
      headers: {
        Accept: 'text/html',
      },
    })
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as any
    // In this case, it calls next() which returns nextMock's result
    expect(res.response).toBeDefined()
    const body = await res.response.text()
    expect(body).toBe('HTML content')
  })

  test('/auth.md returns Markdown instructions', async () => {
    const request = new Request('https://example.com/auth.md')
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')

    const body = await res.text()
    expect(body).toContain('# auth.md')
    expect(body).toContain('agent registration')
  })

  test('/.well-known/api-catalog returns application/linkset+json', async () => {
    const request = new Request('https://example.com/.well-known/api-catalog')
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain(
      'application/linkset+json'
    )

    const data = (await res.json()) as LinkSetResponse
    expect(data.linkset).toBeDefined()
    expect(data.linkset[0].anchor).toBe('https://example.com/api/v1')
    expect(data.linkset[0]['service-doc']![0].href).toBe(
      'https://docs.chmonitor.dev/reference/api'
    )
    expect(data.linkset[0].status![0].href).toBe(
      'https://example.com/api/health'
    )
  })

  test('/api/v1/openapi.json returns OpenAPI spec', async () => {
    const request = new Request('https://example.com/api/v1/openapi.json')
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain(
      'application/openapi+json'
    )

    const data = (await res.json()) as OpenAPIResponse
    expect(data.openapi).toBe('3.0.0')
    expect(data.info.title).toBe('chmonitor API')
  })

  test('/.well-known/oauth-protected-resource returns protected resource metadata', async () => {
    const request = new Request(
      'https://example.com/.well-known/oauth-protected-resource'
    )
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const data = (await res.json()) as OAuthProtectedResource
    expect(data.resource).toBe('https://example.com/api/v1')
    expect(data.authorization_servers[0]).toBe('https://example.com/api/auth')
  })

  test('/.well-known/oauth-authorization-server returns authorization server metadata', async () => {
    const request = new Request(
      'https://example.com/.well-known/oauth-authorization-server'
    )
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const data = (await res.json()) as OAuthAuthorizationServer
    expect(data.issuer).toBe('https://example.com/api/auth')
    expect(data.agent_auth!.skill).toBe('agent-auth')
    expect(data.agent_auth!.register_uri).toBe(
      'https://example.com/api/v1/agent/register'
    )
  })

  test('/.well-known/openid-configuration returns OpenID config', async () => {
    const request = new Request(
      'https://example.com/.well-known/openid-configuration'
    )
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const data = (await res.json()) as OpenIDConfiguration
    expect(data.issuer).toBe('https://example.com/api/auth')
    expect(data.jwks_uri).toBe('https://example.com/.well-known/jwks.json')
  })

  test('/.well-known/mcp/server-card.json returns MCP server card', async () => {
    const request = new Request(
      'https://example.com/.well-known/mcp/server-card.json'
    )
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const data = (await res.json()) as MCPServerCard
    expect(data.serverInfo.name).toBe('chmonitor-mcp-server')
    expect(data.endpoint).toBe('/api/mcp')
  })

  test('/.well-known/agent-skills/index.json returns skills index', async () => {
    const request = new Request(
      'https://example.com/.well-known/agent-skills/index.json'
    )
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const data = (await res.json()) as AgentSkillsDiscovery
    expect(data.$schema).toBe(
      'https://schemas.agentskills.io/discovery/0.2.0/schema.json'
    )
    expect(data.skills.length).toBeGreaterThan(0)
    expect(data.skills[0].url).toContain('/.well-known/agent-skills/')
    expect(data.skills[0].digest).toContain('sha256:')
  })

  test('/.well-known/agent-skills/:name/SKILL.md returns skill markdown', async () => {
    const request = new Request(
      'https://example.com/.well-known/agent-skills/anomaly-detection/SKILL.md'
    )
    const res = (await agentDiscoveryHandler({
      request,
      next: nextMock,
    })) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')

    const body = await res.text()
    expect(body).toContain('anomaly-detection')
  })

  test('securityHeadersHandler appends Link headers to homepage and overview', async () => {
    const request = new Request('https://example.com/overview')
    const res = (await securityHeadersHandler({
      request,
      next: nextMock,
    })) as any
    expect(res.response).toBeDefined()
    expect(res.response.headers.get('Link')).toBe(
      '</.well-known/api-catalog>; rel="api-catalog", </.well-known/mcp/server-card.json>; rel="mcp-server-card"'
    )
  })

  test('securityHeadersHandler does not append Link headers to other routes', async () => {
    const request = new Request('https://example.com/dashboard')
    const res = (await securityHeadersHandler({
      request,
      next: nextMock,
    })) as any
    expect(res.response).toBeDefined()
    expect(res.response.headers.get('Link')).toBeNull()
  })
})
