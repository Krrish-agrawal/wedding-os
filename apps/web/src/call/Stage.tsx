import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { VIEW_LABELS, type ClientRole, type SessionAction, type SessionState } from '@ave/shared';
import { content, getBundle } from '@/content';
import { VIEWS } from '@/views/registry';
import { Button, EmptyState, propertyTypeIcon } from '@/ui';

interface StageProps {
  state: SessionState;
  dispatch: (action: SessionAction) => void;
  role: ClientRole;
}

const VIEW_FADE = { duration: 0.16, ease: [0.2, 0.9, 0.25, 1] } as const;

/**
 * The call stage. The 3D tour stays mounted underneath at all times so returning to it is instant;
 * every other view cross-fades on top of it with a slight slide.
 * A view that needs a property never renders without one: the stage asks which property instead.
 */
export function Stage({ state, dispatch, role }: StageProps) {
  const bundle = getBundle(state.propertyId);
  const Tour = VIEWS.tour.Component;
  const active = VIEWS[state.view];
  const showTour = state.view === 'tour' && Boolean(bundle);
  const missingProperty = active.needsProperty && !bundle;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-paper shadow-[var(--shadow-pop)]">
        {bundle && (
          <div className="absolute inset-0" style={{ visibility: showTour ? 'visible' : 'hidden' }} aria-hidden={!showTour}>
            <Tour state={state} bundle={bundle} dispatch={dispatch} role={role} active={showTour} />
          </div>
        )}
        <AnimatePresence initial={false}>
          {!showTour && (
            <motion.div
              key={missingProperty ? 'pick-property' : state.view}
              className="absolute inset-0 bg-canvas"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={VIEW_FADE}
            >
              {missingProperty ? (
                <PickProperty view={VIEW_LABELS[state.view]} dispatch={dispatch} />
              ) : (
                <active.Component state={state} bundle={bundle} dispatch={dispatch} role={role} active />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function PickProperty({ view, dispatch }: { view: string; dispatch: (a: SessionAction) => void }) {
  return (
    <EmptyState
      mascot="listening"
      title="Which property should we look at?"
      body={`${view} opens as soon as you pick one.`}
      actions={content.properties.map((b) => (
        <Button
          key={b.property.id}
          variant="secondary"
          icon={propertyTypeIcon(b.property)}
          trailingIcon={ArrowRight}
          onClick={() => dispatch({ type: 'set_property', propertyId: b.property.id })}
        >
          {b.property.name}
        </Button>
      ))}
    />
  );
}
