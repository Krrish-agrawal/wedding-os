import { useState } from 'react';
import { cn } from '@/ui';
import ShotStudio from './ShotStudio';
import RenderStudio from '../render/RenderStudio';

const TABS = [
  { id: 'shots', label: 'Shots' },
  { id: 'render', label: 'Plan and hero renders' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** The 3D authoring tools: shot capture and plan or hero renders. Developer only. */
export default function Studio3D() {
  const [tab, setTab] = useState<TabId>('shots');
  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b-2 border-line px-4 py-2">
        <h1 className="font-display text-lg font-bold">Studio · 3D</h1>
        <nav className="flex gap-1" aria-label="3D tools">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn('rounded-[12px] border-2 px-3 py-1 text-sm font-semibold', tab === t.id ? 'border-ink bg-blue-tint' : 'border-transparent hover:bg-paper')}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">{tab === 'shots' ? <ShotStudio /> : <RenderStudio />}</div>
    </div>
  );
}
