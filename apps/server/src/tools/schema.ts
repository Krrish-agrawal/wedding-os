import { z } from 'zod';
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, TOOL_NAMES, type ToolName } from '@ave/shared';

/** A JSON Schema object for one tool's arguments. */
export interface JsonObjectSchema {
  type: 'object';
  properties: Record<string, JsonProperty>;
  required?: string[];
  additionalProperties?: boolean;
}
export interface JsonProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonProperty;
  [keyword: string]: unknown;
}

const cache = new Map<ToolName, JsonObjectSchema>();

/**
 * The input schema exactly as the MCP SDK advertises it in tools/list (Zod's own converter, draft-07,
 * input side), minus the `$schema` marker. Used for the simulator and Director so every surface shows
 * the model the same definition.
 */
export function toolJsonSchema(name: ToolName): JsonObjectSchema {
  const hit = cache.get(name);
  if (hit) return hit;
  const { $schema: _drop, ...schema } = z.toJSONSchema(TOOL_INPUTS[name], { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  const out = { properties: {}, ...schema, type: 'object' } as JsonObjectSchema;
  cache.set(name, out);
  return out;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: JsonObjectSchema;
}

export function toolDefinitions(): ToolDefinition[] {
  return TOOL_NAMES.map((name) => ({ name, description: TOOL_DESCRIPTIONS[name], parameters: toolJsonSchema(name) }));
}
