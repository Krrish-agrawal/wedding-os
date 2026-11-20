import {
  Box,
  CalendarCheck,
  FileCheck,
  Headset,
  IndianRupee,
  Languages,
  LayoutGrid,
  MapPin,
  MessageCircle,
  Mic,
  NotebookPen,
  PhoneIncoming,
  Route,
  Sparkles,
  Sun,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { MascotState } from '@/ui';
import type { Accent } from '@/views/types';

/** All landing-page copy in one place, so the page components stay layout only. */

export interface Pain {
  mascot: MascotState;
  accent: Accent;
  title: string;
  body: string;
}

export const PAINS: Pain[] = [
  {
    mascot: 'sleepy',
    accent: 'sun',
    title: 'Weekends lost to traffic',
    body: 'Three site visits across the city, hours on the road, and the flat looks nothing like its photos.',
  },
  {
    mascot: 'surprised',
    accent: 'coral',
    title: 'Photos hide what matters',
    body: 'Where do the water lines run? Does the balcony get morning sun? Which way does the entrance face?',
  },
  {
    mascot: 'thinking',
    accent: 'grape',
    title: 'Questions at 11\u00a0pm, nobody to ask',
    body: 'Brokers are busy, calls go unanswered, and the price sheet is a blurry PDF on WhatsApp.',
  },
  {
    mascot: 'apologetic',
    accent: 'mint',
    title: 'Moving from another city',
    body: 'Relocating for work means choosing a home you have never walked through.',
  },
];

export interface Neighbourhood {
  name: string;
  vibe: string;
  accent: Accent;
}

/** Areas shown as coming soon. Live areas come from the property data, so they never drift from it. */
export const COMING_SOON: Neighbourhood[] = [
  { name: 'HSR Layout', vibe: 'Wide sector roads, startups and the lake', accent: 'mint' },
  { name: 'Whitefield', vibe: 'Tech parks and gated communities', accent: 'grape' },
  { name: 'Jayanagar', vibe: 'Leafy blocks and the 4th Block market', accent: 'sun' },
  { name: 'Hebbal', vibe: 'Lakeside living on the airport road', accent: 'blue' },
  { name: 'Sarjapur Road', vibe: 'New launches along the IT corridor', accent: 'coral' },
  { name: 'Malleshwaram', vibe: 'Old Bengaluru charm and temple streets', accent: 'tangerine' },
];

export interface Feature {
  icon: LucideIcon;
  accent: Accent;
  title: string;
  body: string;
}

/** What the advisor can put on screen. Mirrors the call's view dock. */
export const SCREEN_FEATURES: Feature[] = [
  { icon: LayoutGrid, accent: 'blue', title: 'Shortlist', body: 'Homes that fit your budget and must-haves, side by side.' },
  { icon: Box, accent: 'blue', title: '3D tour', body: 'Walk room to room as you ask: “show me the kitchen”.' },
  { icon: Zap, accent: 'grape', title: 'Wiring and plumbing', body: 'The floor plan with electrical and water lines, room by room.' },
  { icon: MapPin, accent: 'tangerine', title: 'Locality', body: 'Schools, hospitals, cafés and metro stops around the home.' },
  { icon: Route, accent: 'tangerine', title: 'Commute', body: 'Drive and metro times to your office at rush hour.' },
  { icon: Sun, accent: 'sun', title: 'Sun and Vastu', body: 'Sunlight through the day, and which way every room faces.' },
  { icon: IndianRupee, accent: 'coral', title: 'Price and EMI', body: 'The all-in price, your EMI, and offers applied while you watch.' },
  { icon: FileCheck, accent: 'mint', title: 'Legal checks', body: 'RERA, title and approvals, one document at a time.' },
  { icon: CalendarCheck, accent: 'mint', title: 'Site visit', body: 'Pick a slot; the invite lands on WhatsApp and email.' },
];

/** What makes the call itself different. `{advisor}` is replaced with the advisor's name. */
export const CALL_FEATURES: Feature[] = [
  { icon: Mic, accent: 'blue', title: 'Just talk', body: 'A real voice conversation in your browser. Interrupt any time, or type if you prefer.' },
  { icon: Languages, accent: 'grape', title: 'English, हिन्दी, ಕನ್ನಡ', body: 'Pick your language before the call; {advisor} listens and replies in it.' },
  { icon: Headset, accent: 'coral', title: 'A person when you want one', body: 'Ask for a human and a senior advisor joins the same call, already briefed.' },
  { icon: MessageCircle, accent: 'mint', title: 'Recap on WhatsApp and email', body: 'Prices, your visit time and next steps, sent when the call ends.' },
];

export interface Step {
  mascot: MascotState;
  title: string;
  body: string;
}

export const STEPS: Step[] = [
  { mascot: 'wave', title: '{advisor} calls you', body: 'Leave your name and number. Accept the call in your browser; there is nothing to install.' },
  { mascot: 'listening', title: 'Ask out loud', body: '“What’s the EMI with 1.5 crore down?” The screen moves to the answer while you talk.' },
  { mascot: 'happy', title: 'Leave with a plan', body: 'Book a site visit and get a recap of everything you discussed.' },
];

export const TEAM_FEATURES: Feature[] = [
  { icon: PhoneIncoming, accent: 'coral', title: 'Incoming-call alerts', body: 'When a buyer asks for a person, the Lead Desk rings with the AI’s brief.' },
  { icon: NotebookPen, accent: 'sun', title: 'Live notes during handoff', body: 'While your advisor talks, AI notes what the buyer asked, what was promised and what needs approval.' },
  { icon: Sparkles, accent: 'grape', title: 'A copilot for your advisor', body: 'Type “show the plumbing” or “send the price sheet on WhatsApp”. Messages wait for your OK.' },
  { icon: Workflow, accent: 'mint', title: 'A pipeline that runs itself', body: 'Bookings post to Slack, open Jira tasks, update HubSpot and message the buyer.' },
];

export const INTEGRATIONS = ['Slack', 'Jira', 'HubSpot', 'WhatsApp', 'Email'];

export const withAdvisor = (text: string, advisor: string) => text.replaceAll('{advisor}', advisor);
