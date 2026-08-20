//! Built-in prompt packs for `chm prompt` / agent shortcuts.

#[derive(Debug, Clone, Copy)]
pub struct PromptPack {
    pub name: &'static str,
    pub summary: &'static str,
    pub body: &'static str,
}

pub const PROMPTS: &[PromptPack] = &[
    PromptPack {
        name: "slow-queries",
        summary: "Find and explain the slowest recent queries",
        body: "List the slowest queries from the last hour. For each, explain why it is slow and suggest concrete fixes (ORDER BY, projections, settings).",
    },
    PromptPack {
        name: "disk-pressure",
        summary: "Assess disk usage and recommend TTL / cleanup",
        body: "Summarize disk usage by table and part. Flag tables at risk of filling the volume and recommend TTL or DROP PARTITION actions.",
    },
    PromptPack {
        name: "replication-health",
        summary: "Check replica lag and queue depth",
        body: "Inspect replication status across replicas. Report lag, queue size, and any stuck fetches. Suggest remediation steps.",
    },
    PromptPack {
        name: "merge-storm",
        summary: "Diagnose heavy merge activity",
        body: "Are merges backing up? Report active merges, parts per partition, and whether insert patterns look like a merge storm. Recommend settings changes if needed.",
    },
    PromptPack {
        name: "cluster-report",
        summary: "One-page cluster health narrative",
        body: "Produce a concise cluster health report covering queries, merges, replication, disk, and errors. Lead with the top three risks.",
    },
];

pub fn find(name: &str) -> Option<&'static PromptPack> {
    PROMPTS
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name.trim()))
}

pub fn list() -> &'static [PromptPack] {
    PROMPTS
}
