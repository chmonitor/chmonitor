/**
 * Fetch ClickHouse changelog from GitHub
 */

import { GITHUB_URLS } from './constants'

export async function fetchChangelog(): Promise<string> {
  console.log('Fetching CHANGELOG.md from GitHub...')

  const response = await fetch(GITHUB_URLS.changelog)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch changelog: ${response.status} ${response.statusText}`
    )
  }

  const content = await response.text()
  console.log(`Fetched ${content.length} bytes`)

  return content
}

export async function fetchTableDocs(
  tableName: string
): Promise<string | null> {
  const shortName = tableName.replace('system.', '')
  const url = `${GITHUB_URLS.docsBase}/${shortName}.md`

  console.log(`Fetching docs for ${tableName}...`)

  try {
    const response = await fetch(url)

    if (!response.ok) {
      console.warn(`No docs found for ${tableName}`)
      return null
    }

    return await response.text()
  } catch (error) {
    console.warn(`Error fetching docs for ${tableName}:`, error)
    return null
  }
}
