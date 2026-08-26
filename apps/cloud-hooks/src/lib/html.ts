/**
 * Minimal Telegram-HTML text escaping. Values interpolated into messages sent
 * with parse_mode:'HTML' must pass through here — markup-significant input
 * otherwise breaks parsing (message rejected → notification lost) or lets a
 * sender control formatting in the ops channel.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
