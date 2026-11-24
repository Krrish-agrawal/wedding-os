import { Link } from 'react-router';
import { Boxes } from 'lucide-react';
import { Pill, buttonClasses } from '@/ui';
import ChatPanel from './ChatPanel';
import { useWedding } from './useWedding';

export default function Planner() {
  const meta = useWedding((s) => s.meta);
  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl font-extrabold">AI Wedding Planner</h1>
        <div className="flex items-center gap-2">
          {meta ? <Pill tone={meta.plannerMode === 'llm' ? 'live' : 'waiting'} dot>{meta.plannerMode === 'llm' ? `AI model: ${meta.model}` : 'Demo mode'}</Pill> : null}
          <Link to="/studio" className={buttonClasses('secondary', 'sm')}><Boxes size={16} aria-hidden />Watch in the 3D Studio</Link>
        </div>
      </header>
      <ChatPanel />
    </div>
  );
}
