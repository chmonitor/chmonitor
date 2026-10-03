// Post authors, keyed by the `author` frontmatter id. Posts without one are
// credited to DEFAULT_AUTHOR.
export type Author = {
  name: string
  url: string
  avatar: string
}

export const DEFAULT_AUTHOR = 'duyet'

export const AUTHORS: Record<string, Author> = {
  duyet: {
    name: 'Duyet Le',
    url: 'https://github.com/duyet',
    avatar: 'https://github.com/duyet.png?size=80',
  },
  duyetbot: {
    name: 'duyetbot',
    url: 'https://github.com/duyetbot',
    avatar: 'https://github.com/duyetbot.png?size=80',
  },
}

export function postAuthor(id: string | undefined): Author {
  const key = id ?? DEFAULT_AUTHOR
  const author = AUTHORS[key]
  if (!author) throw new Error(`Unknown blog author "${key}" — add it to src/lib/authors.ts`)
  return author
}
