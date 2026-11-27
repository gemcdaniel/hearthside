import type { SVGProps } from 'react';

function IconBase({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="hs-sudoku-icon"
      {...props}
    >
      {children}
    </svg>
  );
}

export function BackIcon() {
  return (
    <IconBase>
      <path d="M15 18l-6-6 6-6" />
      <path d="M9 12h10" />
    </IconBase>
  );
}

export function PauseIcon() {
  return (
    <IconBase>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </IconBase>
  );
}

export function PlayIcon() {
  return (
    <IconBase>
      <polygon points="7 4 19 12 7 20 7 4" fill="currentColor" />
    </IconBase>
  );
}

export function NewPuzzleIcon() {
  return (
    <IconBase>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </IconBase>
  );
}

export function UndoIcon() {
  return (
    <IconBase>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </IconBase>
  );
}

export function RedoIcon() {
  return (
    <IconBase>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </IconBase>
  );
}

export function EraseIcon() {
  return (
    <IconBase>
      <path d="M21 4H9l-7 8 7 8h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z" />
      <path d="M17 9l-6 6" />
      <path d="M11 9l6 6" />
    </IconBase>
  );
}

export function NotesIcon() {
  return (
    <IconBase>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </IconBase>
  );
}

export function AutoShowIcon() {
  return (
    <IconBase>
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
      <path d="M5 18l.9 2.1L8 21l-2.1.9L5 24l-.9-2.1L2 21l2.1-.9L5 18z" />
      <path d="M19 15l.7 1.6L21.3 17l-1.6.7L19 19.3l-.7-1.6L16.7 17l1.6-.7L19 15z" />
    </IconBase>
  );
}

export function CheckIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  );
}

export function HintIcon() {
  return (
    <IconBase>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.8 10.6c.7.6 1.3 1.4 1.5 2.4h4.6c.2-1 .8-1.8 1.5-2.4A6 6 0 0 0 12 3z" />
    </IconBase>
  );
}

export function RotatePhoneIcon() {
  return (
    <IconBase>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M11 18h2" />
    </IconBase>
  );
}
