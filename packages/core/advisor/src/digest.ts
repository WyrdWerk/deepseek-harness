/**
 * Transcript digest construction for advisory reviews.
 *
 * @module dsh-advisor/digest
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'

const USER_TEXT_BUDGET = 1_500
const ASSISTANT_TEXT_BUDGET = 2_000
const REASONING_BUDGET = 800
const TOOL_CALL_BUDGET = 400
const TOOL_RESULT_BUDGET = 600

function truncation(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function nestedText(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => block.type === 'text'
    ? block.text
    : block.type === 'tool-result' ? nestedText(block.content) : '').join('')
}

function isAdvisorInjection(message: Message): boolean {
  const source = message.source as { kind?: string; plugin?: string }
  return source?.kind === 'plugin' && source.plugin === 'advisor'
}

/**
 * Render the tail of a conversation as a compact reviewer digest, skipping
 * the advisor's own prior notes so a review never grades its own advice.
 * @param messages - the derived session history.
 * @param budget - approximate character budget for the whole digest.
 * @returns newline-joined digest lines, newest last.
 */
export function buildDigest(messages: readonly Message[], budget: number): string {
  const lines: string[] = []
  for (const message of messages) {
    if (isAdvisorInjection(message)) continue
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'text' && block.text.trim().length > 0) {
          lines.push(`[Assistant]: ${truncation(block.text, ASSISTANT_TEXT_BUDGET)}`)
        } else if (block.type === 'reasoning' && block.text.trim().length > 0) {
          lines.push(`[Reasoning]: ${truncation(block.text, REASONING_BUDGET)}`)
        } else if (block.type === 'tool-call') {
          lines.push(`[Tool call ${block.name}]: ${truncation(block.arguments, TOOL_CALL_BUDGET)}`)
        }
      }
      continue
    }
    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim().length > 0) {
        lines.push(`[User]: ${truncation(block.text, USER_TEXT_BUDGET)}`)
      } else if (block.type === 'tool-result') {
        const text = nestedText(block.content).trim()
        const label = block.isError === true ? ' (error)' : ''
        lines.push(`[Tool result${label}]: ${truncation(text.length > 0 ? text : '(no output)', TOOL_RESULT_BUDGET)}`)
      }
    }
  }
  const tail: string[] = []
  let used = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined) break
    if (used + line.length > budget && tail.length > 0) break
    tail.unshift(line)
    used += line.length
    if (used >= budget) break
  }
  return tail.join('\n')
}
