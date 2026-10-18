'use client'

import {
  AlibabaIcon,
  AmazonBedrockIcon,
  AnthropicIcon,
  AnyRouterIcon,
  AzureIcon,
  BasetenIcon,
  CerebrasIcon,
  CloudflareIcon,
  DeepInfraIcon,
  DeepSeekIcon,
  FastRouterIcon,
  FireworksAIIcon,
  GitHubCopilotIcon,
  GoogleIcon,
  GroqIcon,
  HuggingFaceIcon,
  LMStudioIcon,
  MetaIcon,
  MistralIcon,
  MonogramProviderIcon,
  MoonshotIcon,
  NebiusIcon,
  NvidiaIcon,
  OpenAIIcon,
  OpenCodeIcon,
  OpenRouterIcon,
  PerplexityIcon,
  ReplicateIcon,
  ScaleWayIcon,
  TogetherAIIcon,
  UnknownProviderIcon,
  UpstageIcon,
  V0Icon,
  VeniceIcon,
  VercelIcon,
  VertexAIIcon,
  VultrIcon,
  WandbIcon,
  XAIIcon,
  ZAIIcon,
  ZhipuAIIcon,
} from '@/components/icons/providers'

type ProviderIconComponent = React.ComponentType<{
  className?: string
  size?: number
}>

const PROVIDER_ICONS: Record<string, ProviderIconComponent> = {
  anyrouter: AnyRouterIcon,
  openrouter: OpenRouterIcon,
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  google: GoogleIcon,
  nvidia: NvidiaIcon,
  mistral: MistralIcon,
  perplexity: PerplexityIcon,
  deepinfra: DeepInfraIcon,
  'fireworks-ai': FireworksAIIcon,
  fireworks: FireworksAIIcon,
  deepseek: DeepSeekIcon,
  groq: GroqIcon,
  togetherai: TogetherAIIcon,
  vercel: VercelIcon,
  xai: XAIIcon,
  huggingface: HuggingFaceIcon,
  meta: MetaIcon,
  llama: MetaIcon,
  azure: AzureIcon,
  cerebras: CerebrasIcon,
  replicate: ReplicateIcon,
  'github-copilot': GitHubCopilotIcon,
  'github-models': GitHubCopilotIcon,
  'cloudflare-workers-ai': CloudflareIcon,
  cloudflare: CloudflareIcon,
  v0: V0Icon,
  'amazon-bedrock': AmazonBedrockIcon,
  amazonbedrock: AmazonBedrockIcon,
  scaleway: ScaleWayIcon,
  nebius: NebiusIcon,
  vultr: VultrIcon,
  upstage: UpstageIcon,
  alibaba: AlibabaIcon,
  'alibaba-cn': AlibabaIcon,
  moonshotai: MoonshotIcon,
  'moonshotai-cn': MoonshotIcon,
  zhipuai: ZhipuAIIcon,
  'zhipuai-coding-plan': ZhipuAIIcon,
  zai: ZAIIcon,
  'zai-coding-plan': ZAIIcon,
  fastrouter: FastRouterIcon,
  wandb: WandbIcon,
  opencode: OpenCodeIcon,
  'google-vertex': VertexAIIcon,
  'google-vertex-anthropic': VertexAIIcon,
  lmstudio: LMStudioIcon,
  baseten: BasetenIcon,
  venice: VeniceIcon,
}

export function ProviderIcon({
  provider,
  className,
  size = 13,
}: {
  provider: string
  className?: string
  size?: number
}) {
  const key = provider.toLowerCase().replace(/[-_\s]/g, '')
  const Icon =
    PROVIDER_ICONS[key] ??
    PROVIDER_ICONS[provider.toLowerCase()] ??
    UnknownProviderIcon

  if (Icon === UnknownProviderIcon) {
    return (
      <MonogramProviderIcon
        provider={provider}
        className={className}
        size={size}
      />
    )
  }

  return <Icon className={className} size={size} />
}
