const MIRROR_PROPERTIES = [
  'direction',
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'MozTabSize',
  'whiteSpace',
  'wordWrap',
] as const

export function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number
): { top: number; left: number; height: number } {
  const div = document.createElement('div')
  div.id = 'caret-position-mirror'
  document.body.appendChild(div)

  try {
    const style = div.style
    const computed = window.getComputedStyle(element)

    style.whiteSpace = 'pre-wrap'
    style.wordWrap = 'break-word'
    style.position = 'absolute'
    style.visibility = 'hidden'
    style.overflow = 'hidden'

    for (const prop of MIRROR_PROPERTIES) {
      style.setProperty(prop, computed.getPropertyValue(prop))
    }

    div.textContent = element.value.substring(0, position)

    const span = document.createElement('span')
    span.textContent = element.value.substring(position) || '.'
    div.appendChild(span)

    return {
      top:
        span.offsetTop +
        Number.parseInt(computed.borderTopWidth, 10) -
        element.scrollTop,
      left:
        span.offsetLeft +
        Number.parseInt(computed.borderLeftWidth, 10) -
        element.scrollLeft,
      height:
        Number.parseInt(computed.lineHeight, 10) ||
        Number.parseInt(computed.fontSize, 10) * 1.2,
    }
  } finally {
    if (div.parentNode) div.parentNode.removeChild(div)
  }
}
