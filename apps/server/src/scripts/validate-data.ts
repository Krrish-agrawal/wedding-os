import { ContentError } from '@ave/shared';
import { loadContent } from '../content.js';

try {
  const content = await loadContent();
  for (const b of content.properties) {
    console.log(`ok  ${b.property.id}: ${b.rooms.length} rooms, ${b.tour.stops.length} tour stops, ${b.locality.places.length} places, ${b.commute.routes.length} routes`);
  }
} catch (err) {
  console.error(err instanceof ContentError ? err.message : err);
  process.exit(1);
}
