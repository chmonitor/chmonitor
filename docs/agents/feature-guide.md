# AI Agents Feature Guide

## Overview

chmonitor includes intelligent AI agents powered by LangGraph for natural language interactions and automated analysis. These agents help you:

- **Query in natural language** - Ask questions in plain English and get SQL queries
- **Analyze query performance** - Get intelligent insights about slow queries
- **Detect anomalies** - Automatic detection of unusual patterns in your metrics
- **Generate insights** - Proactive recommendations for optimization

## Setup

### 1. Configure LLM Provider

Add the following environment variables to your `.env.local`:

```bash
# Agent Configuration - OpenRouter free router
OPENROUTER_API_KEY=your-openrouter-api-key
LLM_MODEL=openrouter/free
```

**Supported Providers:**

| Provider | Base URL | Models |
|----------|----------|--------|
| **OpenRouter** (Free tier) | `https://openrouter.ai/api/v1` | `openrouter/free` (default auto-router), `z-ai/glm-4.5-air:free`, `qwen/qwen3-coder:free`, `meta-llama/llama-3.3-70b-instruct:free` |
| **AnyRouter** | `https://anyrouter.dev/api/v1` | `z-ai/glm-4.7-flash`, `google/gemini-3.1-flash-lite`, `google/gemma-4-26b-a4b-it` |
| Anthropic | `https://api.anthropic.com` | `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229` |
| OpenAI | `https://api.openai.com` | `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo` |
| Azure OpenAI | `https://your-resource.openai.azure.com` | `gpt-4` |

### 2. Verify Installation

Run the build to ensure all dependencies are properly installed:

```bash
pnpm run build
```

## Usage

### Natural Language to SQL

Access the chat interface from the navigation menu (AI Assistant) and ask questions in plain language:

**Example queries:**

- "Show me the top 10 tables by disk usage"
- "Which queries took longer than 5 seconds in the last hour?"
- "What's the memory usage trend for the past 24 hours?"
- "Find tables with more than 1 million rows"

The agent will:
1. Understand your intent
2. Generate appropriate SQL
3. Execute the query safely
4. Present results with visualizations

### Query Analysis

Navigate to any query detail page and click the "AI Analysis" button to get:

- Performance bottleneck identification
- Optimization suggestions
- Index recommendations
- Query rewrite proposals

### Anomaly Detection

The system automatically monitors for anomalies in:

- Query execution times
- Memory usage patterns
- Disk I/O spikes
- Connection pool exhaustion

Anomalies are displayed as alerts on the overview page with detailed explanations and remediation steps.

### Insight Generation

Click the "Generate Insights" button on any dashboard to receive:

- Unusual pattern detection
- Correlation analysis between metrics
- Resource optimization opportunities
- Security recommendations

## Features by Agent

### Text-to-SQL Agent

Converts natural language to ClickHouse SQL queries with:

- Schema awareness (knows your tables and columns)
- ClickHouse-specific syntax optimization
- Safe query execution (timeout and row limits)
- Result visualization suggestions

### Query Analysis Agent

Analyzes query performance and provides:

- Execution plan breakdown
- Bottleneck identification
- Optimization recommendations
- Before/after comparison
- Deterministic read-only query repair for common ClickHouse issues

### Diagnostics Agent

Scans recent system metadata and query history for:

- Expensive repeated query patterns
- Repeated query failures
- High active part counts and pending mutations
- Replication lag or readonly replicas
- Table-design candidates such as ORDER BY, LowCardinality, skip indexes, and materialized views

### Anomaly Detection Agent

Monitors metrics for unusual patterns:

- Statistical outlier detection
- Trend deviation alerts
- Multi-metric correlation
- Root cause analysis

### Insight Generation Agent

Proactively generates actionable insights:

- Resource utilization trends
- Performance patterns
- Security audit findings
- Capacity planning recommendations

## Limitations

- Queries are limited to 1000 rows by default
- Query execution timeout: 60 seconds
- DML operations (INSERT, UPDATE, DELETE) are blocked
- Only SELECT queries are allowed
- System tables access only

## Privacy

- All query execution happens on your server
- LLM API calls send only schema metadata and query context
- No actual data rows are sent to external APIs
- API keys are stored server-side and never exposed to clients

## Troubleshooting

**Agent returns "API key not configured":**

```bash
# Verify the default OpenRouter key is set and valid
echo $OPENROUTER_API_KEY

# Older deployments may still use the generic fallback key
echo $LLM_API_KEY
echo $LLM_MODEL

# Restart your development server
pnpm run dev
```

**Queries timeout frequently:**

```bash
# Increase query timeout
CLICKHOUSE_MAX_EXECUTION_TIME=120
```

**Unexpected SQL generated:**

- The agent uses ClickHouse system table schemas
- Ensure your ClickHouse version is supported (23.8+)
- Report issues with schema information for improvements

## Best Practices

1. **Be specific** - "Show tables with >1M rows" is better than "Show big tables"
2. **Use time ranges** - "Queries in the last hour" helps limit data
3. **Ask for aggregations** - "Average query duration by user" returns less data than "All queries"
4. **Review generated SQL** - Always review SQL before execution in production
5. **Use analysis wisely** - AI insights are recommendations, not definitive answers

## Examples

### Disk Usage Analysis

```
User: Which databases are using the most disk space?

Agent generates:
SELECT
  database,
  formatReadableSize(sum(bytes_on_disk)) as disk_size,
  sum(bytes_on_disk) as bytes
FROM system.parts
WHERE active
GROUP BY database
ORDER BY bytes DESC
```

### Slow Query Detection

```
User: Find queries slower than 10 seconds from today

Agent generates:
SELECT
  query,
  query_duration_ms,
  user,
  read_rows,
  read_bytes
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_duration_ms > 10000
  AND event_date >= today()
ORDER BY query_duration_ms DESC
LIMIT 100
```

### Memory Analysis

```
User: What's causing high memory usage?

Agent analyzes:
1. Current memory allocation by component
2. Top memory-consuming queries
3. Cache hit ratios
4. Memory growth trends

And provides recommendations for:
- Reducing max_memory_usage
- Enabling external memory settings
- Optimizing GROUP BY operations
```
