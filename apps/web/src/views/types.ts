import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ClientRole, PropertyBundle, SessionAction, SessionState, ViewId } from '@ave/shared';

/** Props every stage view receives. Views render from these and never fetch at switch time. */
export interface ViewProps {
  state: SessionState;
  /** The active property's content, or null before a property is opened. */
  bundle: PropertyBundle | null;
  /** Emits a session action (a click, a slider). The server reduces it and broadcasts. */
  dispatch: (action: SessionAction) => void;
  role: ClientRole;
  /** False while the view is mounted but hidden (the tour stays mounted). */
  active: boolean;
}

export type Accent = 'blue' | 'grape' | 'tangerine' | 'sun' | 'coral' | 'mint';

export interface ViewModule {
  id: ViewId;
  Component: ComponentType<ViewProps>;
  accent: Accent;
  /** Icon rendered by the dock (one icon family: lucide). */
  icon: LucideIcon;
  /** Whether the view needs an open property. */
  needsProperty: boolean;
}
