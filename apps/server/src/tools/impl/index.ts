import type { ToolInput, ToolName, ToolResult } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { showBlueprint } from './blueprint.js';
import { showCommute } from './commute.js';
import { showCompass } from './compass.js';
import { requestHuman, sendReport, updateLead } from './lead.js';
import { showLegal } from './legal.js';
import { showLocality } from './locality.js';
import { applyOffer, requestDiscount, showMoney } from './money.js';
import { openProperty, showShortlist } from './property.js';
import { tourGoTo, tourWalkthrough } from './tour.js';
import { bookSiteVisit, getVisitSlots } from './visits.js';

export type ToolImpl<N extends ToolName> = (tc: ToolContext, input: ToolInput<N>) => ToolResult | Promise<ToolResult>;

/** One plain function per tool. Adapters (MCP, HTTP, Director, simulator) all call these through `runTool`. */
export const TOOL_IMPLS: { [N in ToolName]: ToolImpl<N> } = {
  showShortlist,
  openProperty,
  tourGoTo,
  tourWalkthrough,
  showBlueprint,
  showLocality,
  showCommute,
  showCompass,
  showMoney,
  applyOffer,
  requestDiscount,
  showLegal,
  getVisitSlots,
  bookSiteVisit,
  updateLead,
  sendReport,
  requestHuman,
};
