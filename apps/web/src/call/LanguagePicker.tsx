import { Languages } from 'lucide-react';
import { CALL_LANGUAGES, CALL_LANGUAGE_INFO, type CallLanguage, type SessionAction } from '@ave/shared';
import { ICON_STROKE, cn } from '@/ui';

interface LanguagePickerProps {
  language: CallLanguage;
  dispatch: (action: SessionAction) => void;
  /** While the advisor restarts in a new language, further switches wait. */
  disabled?: boolean;
  size?: 'md' | 'lg';
}

/**
 * The call's one language. Picking another restarts the advisor in it: recognition, replies and voice
 * all switch, and the advisor greets the buyer again in the new language.
 */
export function LanguagePicker({ language, dispatch, disabled = false, size = 'md' }: LanguagePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Call language"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-chip)] border-2 border-ink bg-canvas p-1 shadow-[var(--shadow-pop-sm)]',
        size === 'lg' ? 'h-12' : 'h-11',
      )}
    >
      <Languages size={16} strokeWidth={ICON_STROKE} aria-hidden className="mx-1.5 shrink-0 text-blue-deep" />
      {CALL_LANGUAGES.map((id) => {
        const on = id === language;
        const info = CALL_LANGUAGE_INFO[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            lang={id}
            title={info.label}
            disabled={disabled && !on}
            onClick={() => {
              if (!on) dispatch({ type: 'set_language', language: id });
            }}
            className={cn(
              'h-full rounded-[var(--radius-chip)] px-3 text-sm font-bold transition-colors duration-100 disabled:cursor-wait disabled:opacity-50',
              on ? 'bg-blue text-ink' : 'text-ink-soft hover:bg-blue-tint hover:text-ink',
            )}
          >
            {info.native}
          </button>
        );
      })}
    </div>
  );
}
