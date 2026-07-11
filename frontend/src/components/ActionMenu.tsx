import { useEffect, useRef, useState } from 'react';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  /** Renders the item in the danger color (e.g. Delete). */
  danger?: boolean;
}

/** A menu is a flat list of clickable actions, optionally broken up by non-interactive section
 * headings and separators (used e.g. to group the "Move to" project targets above Delete). */
export type ActionMenuEntry = ActionMenuItem | { heading: string } | { separator: true };

interface ActionMenuProps {
  /** Accessible name for the "…" trigger, e.g. `More actions for "Buy milk"`. */
  buttonLabel: string;
  items: ActionMenuEntry[];
  /** Extra class on the wrapper so callers can drive hover-reveal from their own row styles. */
  className?: string;
}

/**
 * A "…" overflow button that reveals a small popover of actions. Used for the per-row secondary
 * actions (task: move-to-project + delete; project: edit + delete) so they stay tucked away until
 * wanted rather than sitting visible on every row. Closes on outside click, Escape, or selecting
 * an item.
 *
 * Click events are stopped from propagating so opening the menu (or picking an item) on a row that
 * is itself clickable -- a task row that opens its detail view, a project row that selects the
 * project -- doesn't also trigger that row action.
 */
export function ActionMenu({ buttonLabel, items, className }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const wrapperClass = isOpen
    ? `action-menu action-menu--open${className ? ` ${className}` : ''}`
    : `action-menu${className ? ` ${className}` : ''}`;

  return (
    <div className={wrapperClass} ref={wrapperRef}>
      <button
        type="button"
        className="action-menu__trigger"
        aria-label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
      >
        ⋯
      </button>
      {isOpen && (
        <div className="action-menu__popover" role="menu">
          {items.map((entry, index) => {
            if ('separator' in entry) {
              return <div key={index} className="action-menu__separator" role="separator" />;
            }
            if ('heading' in entry) {
              return (
                <div key={index} className="action-menu__heading" aria-hidden="true">
                  {entry.heading}
                </div>
              );
            }
            return (
              <button
                key={index}
                type="button"
                role="menuitem"
                className={
                  entry.danger
                    ? 'action-menu__item action-menu__item--danger'
                    : 'action-menu__item'
                }
                onClick={(event) => {
                  event.stopPropagation();
                  setIsOpen(false);
                  entry.onSelect();
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
