import { summarizeBudget, type Enquiry, type WeddingState } from '@ave/shared';

export interface ChecklistItem { id: string; text: string; tone: 'todo' | 'warn' | 'info'; to: string }

export function daysUntil(date: string | null, now: Date = new Date()): number | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86_400_000);
}

/** Pure: reminders computed from the plan itself. Not a notification service: nothing is sent to anyone. */
export function planningChecklist(s: WeddingState, enquiries: readonly Enquiry[] = [], now: Date = new Date()): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const b = summarizeBudget(s);
  const days = daysUntil(s.profile.date, now);
  if (!s.profile.onboarded) out.push({ id: 'onboard', text: 'Finish the welcome questions so the planner knows your wedding.', tone: 'todo', to: '/welcome' });
  if (!s.profile.date) out.push({ id: 'date', text: 'Set your wedding date.', tone: 'todo', to: '/' });
  else if (days !== null && days < 0) out.push({ id: 'past', text: 'Your wedding date is in the past. Check the date.', tone: 'warn', to: '/' });
  else if (days !== null && days <= 30) out.push({ id: 'soon', text: `Your wedding is ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}. Confirm vendors and final headcount.`, tone: 'warn', to: '/vendors/mine' });
  else if (days !== null && days <= 90) out.push({ id: 'soon90', text: `Your wedding is in ${days} days. Time to lock in key vendors.`, tone: 'info', to: '/vendors' });
  if (b.total === 0) out.push({ id: 'budget', text: 'Set a total budget.', tone: 'todo', to: '/budget' });
  else if (b.allocated === 0) out.push({ id: 'alloc', text: 'Split your budget across categories.', tone: 'todo', to: '/budget' });
  if (b.overBudget) out.push({ id: 'over', text: 'You are over budget. Review your expenses.', tone: 'warn', to: '/budget' });
  if (!s.venueId) out.push({ id: 'venue', text: 'Choose a venue.', tone: 'todo', to: '/' });
  if (!s.vendorShortlist.some((v) => v.category === 'decorator')) out.push({ id: 'decorator', text: 'Shortlist a decorator.', tone: 'todo', to: '/vendors' });
  const waiting = enquiries.filter((e) => e.status === 'requested' || e.status === 'sample_quote_ready').length;
  if (waiting > 0) out.push({ id: 'enq', text: `${waiting} quote request${waiting === 1 ? ' is' : 's are'} still awaiting a vendor response.`, tone: 'info', to: '/vendors/mine' });
  return out;
}
