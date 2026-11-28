import { PRESET_NICKNAMES } from '@hearthside/game-core';
import { useState } from 'react';

export interface NicknamePickerProps {
  readonly label?: string;
  readonly currentValue?: string;
  readonly onSelectNickname: (nickname: string) => void;
}

export function NicknamePicker({
  label = 'Fun Nicknames',
  currentValue,
  onSelectNickname,
}: NicknamePickerProps) {
  const [expanded, setExpanded] = useState(false);

  function handleSurpriseMe() {
    if (PRESET_NICKNAMES.length === 0) {
      return;
    }
    const candidates = PRESET_NICKNAMES.filter((name) => name !== currentValue);
    const pool = candidates.length > 0 ? candidates : PRESET_NICKNAMES;
    const picked = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
    if (picked) {
      onSelectNickname(picked);
    }
  }

  return (
    <div className="hs-nickname-picker">
      <div className="hs-btn-group">
        <button
          type="button"
          className="hs-btn hs-btn-secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? `Hide ${label}` : label}
        </button>
        <button type="button" className="hs-btn hs-btn-secondary" onClick={handleSurpriseMe}>
          Surprise Me
        </button>
      </div>

      {expanded ? (
        <div className="hs-nickname-chips" role="group" aria-label={label}>
          {PRESET_NICKNAMES.map((preset) => (
            <button
              key={preset}
              type="button"
              className="hs-btn hs-btn-secondary hs-nickname-chip"
              aria-pressed={currentValue === preset}
              onClick={() => onSelectNickname(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
