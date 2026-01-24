/**
 * Token counting utilities for context chunking.
 * Uses word-based approximation since exact token counting requires
 * a tokenizer specific to the model being used.
 */

/**
 * Average tokens per word approximation.
 * This is a rough estimate based on typical English text.
 * Actual token counts vary by model and text content.
 */
const TOKENS_PER_WORD = 1.3;

/**
 * Estimates the number of tokens in a given text.
 * Uses a simple word-based approximation (roughly 1.3 tokens per word).
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated number of tokens
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  // Split on whitespace to count words
  const words = text.split(/\s+/).filter(word => word.length > 0);

  // Apply the tokens per word ratio and round up
  return Math.ceil(words.length * TOKENS_PER_WORD);
}

/**
 * Truncates text to fit within a token limit while preserving complete words.
 *
 * @param text - The text to truncate
 * @param maxTokens - The maximum number of tokens allowed
 * @returns Truncated text that fits within the token limit
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  if (!text || text.length === 0) {
    return '';
  }

  if (maxTokens <= 0) {
    return '';
  }

  // If already within limit, return as-is
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  // Split into words
  const words = text.split(/\s+/).filter(word => word.length > 0);

  // Calculate maximum words we can include
  const maxWords = Math.floor(maxTokens / TOKENS_PER_WORD);

  if (maxWords <= 0) {
    return '';
  }

  // Take only the allowed number of words and join with single spaces
  const truncatedWords = words.slice(0, maxWords);

  return truncatedWords.join(' ');
}
