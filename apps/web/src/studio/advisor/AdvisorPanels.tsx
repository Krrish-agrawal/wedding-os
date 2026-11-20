import { useState } from 'react';
import { MessagesSquare, Wrench } from 'lucide-react';
import { Chip } from '@/ui';
import { SimChat } from './SimChat';
import { ToolConsole } from './ToolConsole';

type Panel = 'tools' | 'chat';

/** Studio panels from the Tools workstream: the tool console and the simulated advisor chat. */
export function AdvisorPanels({ sessionId }: { sessionId: string | undefined }) {
  const [panel, setPanel] = useState<Panel>('tools');
  return (
    <section className="flex flex-col gap-3 border-t-2 border-line pt-3" aria-label="Advisor tools">
      <div className="flex gap-2">
        <Chip size="sm" icon={Wrench} label="Tool console" selected={panel === 'tools'} onClick={() => setPanel('tools')} />
        <Chip size="sm" icon={MessagesSquare} accent="grape" label="Advisor chat" selected={panel === 'chat'} onClick={() => setPanel('chat')} />
      </div>
      {/* Both stay mounted so a running chat or a result survives switching tabs. */}
      <div hidden={panel !== 'tools'}>
        <ToolConsole sessionId={sessionId} />
      </div>
      <div hidden={panel !== 'chat'}>
        <SimChat sessionId={sessionId} />
      </div>
    </section>
  );
}
