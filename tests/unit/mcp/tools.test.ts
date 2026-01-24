import { describe, it, expect } from 'vitest';
import {
  ReadFileInputSchema,
  WriteFileInputSchema,
  DeleteFileInputSchema,
  ListDirectoryInputSchema,
  DelegateTaskInputSchema,
  RequestContextInputSchema,
  TOOL_DEFINITIONS,
  zodToJsonSchema,
} from '../../../src/mcp/tools.js';
import { z } from 'zod';

describe('MCP Tools', () => {
  describe('Input Schemas', () => {
    describe('ReadFileInputSchema', () => {
      it('should validate valid read file input', () => {
        const result = ReadFileInputSchema.safeParse({ path: 'test.txt' });
        expect(result.success).toBe(true);
      });

      it('should reject missing path', () => {
        const result = ReadFileInputSchema.safeParse({});
        expect(result.success).toBe(false);
      });
    });

    describe('WriteFileInputSchema', () => {
      it('should validate valid write file input', () => {
        const result = WriteFileInputSchema.safeParse({
          path: 'test.txt',
          content: 'Hello World',
        });
        expect(result.success).toBe(true);
      });

      it('should reject missing path', () => {
        const result = WriteFileInputSchema.safeParse({ content: 'Hello' });
        expect(result.success).toBe(false);
      });

      it('should reject missing content', () => {
        const result = WriteFileInputSchema.safeParse({ path: 'test.txt' });
        expect(result.success).toBe(false);
      });
    });

    describe('DeleteFileInputSchema', () => {
      it('should validate valid delete file input', () => {
        const result = DeleteFileInputSchema.safeParse({ path: 'test.txt' });
        expect(result.success).toBe(true);
      });

      it('should reject missing path', () => {
        const result = DeleteFileInputSchema.safeParse({});
        expect(result.success).toBe(false);
      });
    });

    describe('ListDirectoryInputSchema', () => {
      it('should validate valid list directory input', () => {
        const result = ListDirectoryInputSchema.safeParse({ path: '/src' });
        expect(result.success).toBe(true);
      });

      it('should reject missing path', () => {
        const result = ListDirectoryInputSchema.safeParse({});
        expect(result.success).toBe(false);
      });
    });

    describe('DelegateTaskInputSchema', () => {
      it('should validate valid delegate task input', () => {
        const result = DelegateTaskInputSchema.safeParse({
          description: 'Test task',
          scope: 'execute',
        });
        expect(result.success).toBe(true);
      });

      it('should validate with optional data', () => {
        const result = DelegateTaskInputSchema.safeParse({
          description: 'Test task',
          scope: 'analyze',
          data: { key: 'value' },
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid scope', () => {
        const result = DelegateTaskInputSchema.safeParse({
          description: 'Test task',
          scope: 'invalid',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('RequestContextInputSchema', () => {
      it('should validate valid request context input', () => {
        const result = RequestContextInputSchema.safeParse({ query: '*.ts' });
        expect(result.success).toBe(true);
      });

      it('should reject missing query', () => {
        const result = RequestContextInputSchema.safeParse({});
        expect(result.success).toBe(false);
      });
    });
  });

  describe('TOOL_DEFINITIONS', () => {
    it('should define all expected tools', () => {
      const toolNames = TOOL_DEFINITIONS.map(t => t.name);
      expect(toolNames).toContain('bridge_read_file');
      expect(toolNames).toContain('bridge_write_file');
      expect(toolNames).toContain('bridge_delete_file');
      expect(toolNames).toContain('bridge_list_directory');
      expect(toolNames).toContain('bridge_delegate_task');
      expect(toolNames).toContain('bridge_request_context');
      expect(toolNames).toContain('bridge_status');
    });

    it('should have descriptions for all tools', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    });

    it('should have input schemas for all tools', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.inputSchema).toBeTruthy();
      }
    });
  });

  describe('zodToJsonSchema', () => {
    it('should convert ZodString to JSON schema', () => {
      const schema = z.string().describe('A test string');
      const jsonSchema = zodToJsonSchema(schema);
      expect(jsonSchema.type).toBe('string');
    });

    it('should convert ZodObject to JSON schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      });
      const jsonSchema = zodToJsonSchema(schema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
      expect(jsonSchema.required).toContain('name');
      expect(jsonSchema.required).not.toContain('age');
    });

    it('should convert ZodEnum to JSON schema', () => {
      const schema = z.enum(['a', 'b', 'c']);
      const jsonSchema = zodToJsonSchema(schema);
      expect(jsonSchema.type).toBe('string');
      expect(jsonSchema.enum).toEqual(['a', 'b', 'c']);
    });

    it('should handle ZodOptional', () => {
      const schema = z.string().optional();
      const jsonSchema = zodToJsonSchema(schema);
      expect(jsonSchema.type).toBe('string');
    });

    it('should handle ZodRecord', () => {
      const schema = z.record(z.unknown());
      const jsonSchema = zodToJsonSchema(schema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.additionalProperties).toBe(true);
    });
  });
});
