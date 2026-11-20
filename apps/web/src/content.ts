import { buildContent, type Content, type PropertyBundle } from '@ave/shared';

/**
 * All content from /data, bundled at build time and validated once at startup.
 * Views read from here; nothing about a property is hardcoded in components.
 */
const raw = import.meta.glob('../../../data/**/*.json', { eager: true, import: 'default' });

const files: Record<string, unknown> = {};
for (const [p, json] of Object.entries(raw)) {
  files[p.replace(/^.*\/data\//, '')] = json;
}

export const content: Content = buildContent(files);

export function getBundle(propertyId: string | null): PropertyBundle | null {
  return propertyId ? content.byId[propertyId] ?? null : null;
}

export function otherPropertyId(propertyId: string | null): string | null {
  const ids = content.properties.map((b) => b.property.id);
  if (!propertyId) return ids[0] ?? null;
  return ids.find((id) => id !== propertyId) ?? null;
}
