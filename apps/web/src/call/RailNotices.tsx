import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Keyboard, MicOff, RefreshCw, WifiOff } from 'lucide-react';
import type { SessionState } from '@ave/shared';
import { Button, Notice, Spinner, useOnline } from '@/ui';
import { useSessionStore } from '@/session/useSession';
import { useCallControls } from './controls';
import { useCallUi } from './callUi';
import { HUMAN_ADVISOR_FALLBACK_NAME, HUMAN_ADVISOR_ROLE, useAdvisorName } from './advisor';

/** At most this many notices show at once; the most urgent win. */
const MAX_NOTICES = 2;

interface Item {
  id: string;
  node: ReactNode;
}

/**
 * Calm, stacked status messages between the presence tiles and the captions:
 * offline, reconnecting, the handoff banner, voice unavailable, microphone blocked.
 */
export function RailNotices({ state }: { state: SessionState }) {
  const advisor = useAdvisorName();
  const online = useOnline();
  const connection = useSessionStore((s) => s.connection);
  const voice = useCallControls((s) => s.voice);
  const voiceDetail = useCallControls((s) => s.voiceDetail);
  const mic = useCallControls((s) => s.mic);
  const voiceIssue = useCallUi((s) => s.voiceIssue);
  const typing = useCallUi((s) => s.typing);
  const setTyping = useCallUi((s) => s.setTyping);

  const items: Item[] = [];

  if (!online) {
    items.push({
      id: 'offline',
      node: <Notice tone="error" icon={WifiOff} live="assertive" title="You're offline" body="The call picks up again as soon as your connection is back." />,
    });
  } else if (connection === 'reconnecting') {
    items.push({
      id: 'reconnecting',
      node: <Notice tone="waiting" icon={RefreshCw} title="Reconnecting to your call" body="The screen will catch up in a moment." />,
    });
  }

  if (state.handoff.status === 'requested') {
    items.push({
      id: 'handoff-requested',
      node: (
        <Notice
          tone="waiting"
          mascot="wave"
          title={
            <span className="inline-flex items-center gap-2">
              Connecting you to a senior advisor <Spinner size={13} />
            </span>
          }
          body={`${advisor} will keep helping until they join.`}
        />
      ),
    });
  } else if (state.handoff.status === 'joined') {
    const human = state.handoff.humanName?.trim() || HUMAN_ADVISOR_FALLBACK_NAME;
    items.push({
      id: 'handoff-joined',
      node: <Notice tone="success" mascot="happy" title={`${human} has joined the call`} body={`${HUMAN_ADVISOR_ROLE}. ${advisor} is standing by.`} />,
    });
  }

  // While the type box is open it carries the voice reason itself, so the rail stays clear.
  const voiceDown = voice === 'failed' || voice === 'unavailable' || (Boolean(voiceIssue) && voice !== 'connected');
  if (voiceDown && !typing) {
    const reason = voiceDetail ?? voiceIssue ?? 'Voice could not start';
    items.push({
      id: 'voice',
      node: (
        <Notice
          tone="info"
          icon={Keyboard}
          title="Voice isn't available right now"
          body={`${reason.replace(/\.$/, '')}. You can type to ${advisor} instead.`}
          actions={
            <Button size="sm" variant="secondary" icon={Keyboard} onClick={() => setTyping(true)}>
              Type a message
            </Button>
          }
        />
      ),
    });
  } else if (mic === 'denied' && !typing) {
    items.push({
      id: 'mic-denied',
      node: (
        <Notice
          tone="warn"
          icon={MicOff}
          title="Your microphone is blocked"
          body={`Allow it from the address bar to talk, or type to ${advisor}.`}
          actions={
            <Button size="sm" variant="secondary" icon={Keyboard} onClick={() => setTyping(true)}>
              Type instead
            </Button>
          }
        />
      ),
    });
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 empty:hidden">
      <AnimatePresence initial={false}>
        {items.slice(0, MAX_NOTICES).map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.9, 0.25, 1] }}
            className="overflow-hidden"
          >
            {item.node}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
