import { describe, it, expect } from 'vitest';
import { estimateTokens, truncateToTokenLimit } from '../../../src/utils/tokens';

describe('Token Utils', () => {
  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined-like falsy values', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should estimate token count for simple text', () => {
      const text = 'Hello world this is a test';
      const tokens = estimateTokens(text);
      // 6 words * 1.3 = 7.8, ceil to 8
      expect(tokens).toBe(8);
    });

    it('should estimate token count correctly', () => {
      // 5 words * 1.3 = 6.5, ceil to 7
      const text = 'one two three four five';
      expect(estimateTokens(text)).toBe(7);
    });

    it('should handle single word', () => {
      // 1 word * 1.3 = 1.3, ceil to 2
      expect(estimateTokens('word')).toBe(2);
    });

    it('should handle text with extra whitespace', () => {
      const text = '  one   two   three  ';
      // Should still count 3 words
      const tokens = estimateTokens(text);
      expect(tokens).toBe(4); // 3 * 1.3 = 3.9, ceil to 4
    });

    it('should handle text with newlines and tabs', () => {
      const text = 'one\ntwo\tthree';
      const tokens = estimateTokens(text);
      expect(tokens).toBe(4); // 3 * 1.3 = 3.9, ceil to 4
    });

    it('should handle longer text', () => {
      const words = Array(100).fill('word').join(' ');
      const tokens = estimateTokens(words);
      expect(tokens).toBe(130); // 100 * 1.3 = 130
    });

    it('should handle text with punctuation', () => {
      const text = 'Hello, world! How are you?';
      const tokens = estimateTokens(text);
      // 5 words * 1.3 = 6.5, ceil to 7
      expect(tokens).toBe(7);
    });
  });

  describe('truncateToTokenLimit', () => {
    it('should return empty string for empty input', () => {
      expect(truncateToTokenLimit('', 100)).toBe('');
    });

    it('should return empty string for zero maxTokens', () => {
      expect(truncateToTokenLimit('hello world', 0)).toBe('');
    });

    it('should return empty string for negative maxTokens', () => {
      expect(truncateToTokenLimit('hello world', -10)).toBe('');
    });

    it('should return original text if within token limit', () => {
      const text = 'Hello world';
      // 2 words * 1.3 = 2.6, ceil to 3 tokens
      // With maxTokens of 100, should return original
      expect(truncateToTokenLimit(text, 100)).toBe(text);
    });

    it('should truncate text to fit within token limit', () => {
      const text = 'word '.repeat(100).trim(); // 100 words
      const maxTokens = 50;
      const truncated = truncateToTokenLimit(text, maxTokens);

      // Verify truncated text is within limit
      expect(estimateTokens(truncated)).toBeLessThanOrEqual(maxTokens);
    });

    it('should preserve complete words', () => {
      const text = 'one two three four five six seven eight nine ten';
      const maxTokens = 10; // Should allow ~7 words (10 / 1.3 = 7.69)
      const truncated = truncateToTokenLimit(text, maxTokens);

      // Should not have partial words
      expect(truncated.endsWith(' ')).toBe(false);
      expect(truncated.split(' ').every(word => word.length > 0)).toBe(true);
    });

    it('should return empty string when maxTokens too small for any word', () => {
      const text = 'hello world';
      // 1 word needs about 2 tokens (1 * 1.3 = 1.3 rounded up)
      // maxTokens of 0.5 means maxWords = floor(0.5 / 1.3) = 0
      expect(truncateToTokenLimit(text, 0.5)).toBe('');
    });

    it('should handle very small token limits', () => {
      const text = 'one two three';
      // With maxTokens = 1, maxWords = floor(1/1.3) = 0
      expect(truncateToTokenLimit(text, 1)).toBe('');

      // With maxTokens = 2, maxWords = floor(2/1.3) = 1
      expect(truncateToTokenLimit(text, 2)).toBe('one');
    });

    it('should join truncated words with single spaces', () => {
      const text = 'one  two   three    four';
      const maxTokens = 4; // floor(4/1.3) = 3 words
      const truncated = truncateToTokenLimit(text, maxTokens);

      // Should have single spaces between words
      expect(truncated).toBe('one two three');
    });

    it('should handle text with leading/trailing whitespace when truncating', () => {
      // When truncation occurs, whitespace is normalized
      const text = '  one two three four five  ';
      const maxTokens = 4; // floor(4/1.3) = 3 words max
      const truncated = truncateToTokenLimit(text, maxTokens);

      // Should have single spaces between words after truncation
      expect(truncated).toBe('one two three');
    });

    it('should return original text unchanged when within limit', () => {
      const text = '  one two  ';
      const maxTokens = 100; // Well within limit
      const truncated = truncateToTokenLimit(text, maxTokens);

      // When no truncation needed, original text is returned as-is
      expect(truncated).toBe(text);
    });

    it('should properly truncate to exact word boundary', () => {
      const text = 'a b c d e f g h i j'; // 10 words
      const maxTokens = 13; // floor(13/1.3) = 10 words exactly
      const truncated = truncateToTokenLimit(text, maxTokens);

      expect(truncated).toBe('a b c d e f g h i j');
    });

    it('should truncate when tokens estimate equals limit', () => {
      // 10 words = 13 tokens (10 * 1.3 = 13)
      const text = 'a b c d e f g h i j';
      const truncated = truncateToTokenLimit(text, 13);

      // Should return original since estimate <= limit
      expect(truncated).toBe(text);
    });
  });

  describe('integration', () => {
    it('truncated text should always fit within token limit', () => {
      const testCases = [
        { text: 'word '.repeat(1000).trim(), maxTokens: 100 },
        { text: 'word '.repeat(500).trim(), maxTokens: 50 },
        { text: 'the quick brown fox jumps over the lazy dog', maxTokens: 5 },
        { text: 'a', maxTokens: 2 },
      ];

      for (const { text, maxTokens } of testCases) {
        const truncated = truncateToTokenLimit(text, maxTokens);
        const tokenCount = estimateTokens(truncated);
        expect(tokenCount).toBeLessThanOrEqual(maxTokens);
      }
    });

    it('should maintain consistency between estimate and truncate', () => {
      const text = 'one two three four five six seven eight nine ten';

      for (let maxTokens = 1; maxTokens <= 15; maxTokens++) {
        const truncated = truncateToTokenLimit(text, maxTokens);
        if (truncated.length > 0) {
          expect(estimateTokens(truncated)).toBeLessThanOrEqual(maxTokens);
        }
      }
    });
  });
});
