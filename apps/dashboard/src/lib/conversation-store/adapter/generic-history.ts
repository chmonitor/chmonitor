import type {
  MessageFormatItem,
  MessageFormatRepository,
} from '@assistant-ui/react'

export function upsertHistoryItem<TMessage>(
  repo: MessageFormatRepository<TMessage>,
  item: MessageFormatItem<TMessage>,
  getId: (message: TMessage) => string
): void {
  const id = getId(item.message)
  const index = repo.messages.findIndex((entry) => getId(entry.message) === id)
  if (index >= 0) {
    repo.messages[index] = item
  } else {
    repo.messages.push(item)
  }
  repo.headId = id
}

export function replaceHistoryItem<TMessage>(
  repo: MessageFormatRepository<TMessage>,
  item: MessageFormatItem<TMessage>,
  previousId: string,
  getId: (message: TMessage) => string
): void {
  const index = repo.messages.findIndex(
    (entry) => getId(entry.message) === previousId
  )
  if (index >= 0) {
    repo.messages[index] = item
  } else {
    repo.messages.push(item)
  }
  repo.headId = getId(item.message)
}
