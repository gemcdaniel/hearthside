import type { AvatarId, ProfileAccentId } from '@hearthside/game-core';

interface ProfileAvatarProps {
  readonly avatarId: AvatarId;
  readonly accentColor: ProfileAccentId;
  readonly size?: 'sm' | 'md';
}

function renderAvatarPath(avatarId: AvatarId) {
  switch (avatarId) {
    case 'hearth':
      return (
        <path
          d="M12 3.5c2.2 2.4 5 5.1 5 8.5a5 5 0 1 1-10 0c0-1.9.8-3.7 2-5.2.3 1.4 1.2 2.2 2.1 2.2-.3-1.9.2-3.8.9-5.5Z"
          fill="currentColor"
        />
      );
    case 'star':
      return (
        <path
          d="m12 3.2 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.5l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.2Z"
          fill="currentColor"
        />
      );
    case 'leaf':
      return (
        <path
          d="M19 5c-6.5.2-12 4.3-12 11v3h2v-2.2c5.8-.4 10-4.9 10-11.8ZM9 15c1.1-2.8 3.5-5 6.8-6.2-1.9 2.2-4.1 4.3-6.8 6.2Z"
          fill="currentColor"
        />
      );
    case 'compass':
      return (
        <>
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m14.8 9.2-1.7 4.5-4.5 1.7 1.7-4.5 4.5-1.7Z" fill="currentColor" />
        </>
      );
    case 'owl':
      return (
        <>
          <path
            d="M6 7.5 8.5 5h7L18 7.5v7.5a6 6 0 1 1-12 0V7.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="9.5" cy="10.5" r="1.3" fill="currentColor" />
          <circle cx="14.5" cy="10.5" r="1.3" fill="currentColor" />
          <path d="m12 12-1.2 1.8h2.4L12 12Z" fill="currentColor" />
        </>
      );
    case 'fox':
      return (
        <>
          <path
            d="M5 5.5 9.5 9h5L19 5.5v7.2L12 19l-7-6.3V5.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="9.5" cy="11.5" r="1" fill="currentColor" />
          <circle cx="14.5" cy="11.5" r="1" fill="currentColor" />
        </>
      );
    case 'gem':
      return (
        <path
          d="M7.5 4.5h9l3.5 5-8 10-8-10 3.5-5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      );
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      );
  }
}

export function ProfileAvatar({ avatarId, accentColor, size = 'md' }: ProfileAvatarProps) {
  return (
    <span className="hs-avatar" data-accent={accentColor} data-size={size} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="hs-avatar-svg">
        {renderAvatarPath(avatarId)}
      </svg>
    </span>
  );
}
