import { CodeBlock, CopyButton } from './copy-button'
import { MCP_TOOLS, type McpToolParam } from '@chm/mcp-server/data'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ParamValues {
  [key: string]: string
}

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: McpToolParam
  value: string
  onChange: (val: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-medium">
          <code>{param.name}</code>
        </Label>
        <span className="text-xs text-muted-foreground">{param.type}</span>
        <Badge
          variant={param.required ? 'default' : 'secondary'}
          className="text-[10px] px-1.5 py-0"
        >
          {param.required ? 'required' : 'optional'}
        </Badge>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          param.default !== undefined
            ? `Default: ${param.default}`
            : param.description
        }
        className="h-8 text-xs font-mono"
      />
      <p className="text-xs text-muted-foreground">{param.description}</p>
    </div>
  )
}

export function McpPlayground() {
  const [selectedTool, setSelectedTool] = useState(MCP_TOOLS[0].name)
  const [paramValues, setParamValues] = useState<ParamValues>({})
  const [endpointUrl, setEndpointUrl] = useState(
    'http://localhost:3000/api/mcp'
  )

  useEffect(() => {
    setEndpointUrl(`${window.location.origin}/api/mcp`)
  }, [])

  const tool = MCP_TOOLS.find((t) => t.name === selectedTool)!

  const handleToolChange = (name: string) => {
    setSelectedTool(name)
    setParamValues({})
  }

  const handleParamChange = (name: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [name]: value }))
  }

  const toolArguments = (() => {
    const args: Record<string, string | number> = {}
    for (const param of tool.params) {
      const raw = paramValues[param.name]
      if (raw !== undefined && raw !== '') {
        args[param.name] = param.type === 'number' ? Number(raw) : raw
      } else if (param.default !== undefined) {
        args[param.name] = param.default
      }
    }
    return args
  })()

  const jsonRpcPayload = {
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 1,
    params: {
      name: selectedTool,
      arguments: toolArguments,
    },
  }

  const jsonRpcRequest = JSON.stringify(jsonRpcPayload, null, 2)

  const curlCommand = (() => {
    const jsonPayload = JSON.stringify(jsonRpcPayload)
    const escapedJson = jsonPayload.replace(/'/g, "'\\''")
    return `curl -X POST ${endpointUrl} \\
    -H "Content-Type: application/json" \\
    -d '${escapedJson}'`
  })()

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Playground</CardTitle>
        <CardDescription className="text-xs">
          Select a tool and fill in parameters to generate the JSON-RPC request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Tool selector */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Tool</Label>
          <Select
            value={selectedTool}
            onValueChange={(name) => {
              if (name != null) handleToolChange(name)
            }}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MCP_TOOLS.map((t) => (
                <SelectItem key={t.name} value={t.name} className="text-xs">
                  <code>{t.name}</code>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        </div>

        {/* Parameters */}
        {tool.params.length > 0 && (
          <div className="space-y-3">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parameters
            </h5>
            {tool.params.map((param) => (
              <ParamInput
                key={param.name}
                param={param}
                value={paramValues[param.name] ?? ''}
                onChange={(val) => handleParamChange(param.name, val)}
              />
            ))}
          </div>
        )}

        {/* Generated request */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              JSON-RPC Request
            </h5>
          </div>
          <CodeBlock>{jsonRpcRequest}</CodeBlock>
        </div>

        {/* curl command */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              curl Command
            </h5>
            <CopyButton text={curlCommand} label="Copy curl" />
          </div>
          <CodeBlock>{curlCommand}</CodeBlock>
        </div>
      </CardContent>
    </Card>
  )
}
