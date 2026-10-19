import type { StatisticsTotals } from '../../../../types';
import { Icon } from '../../../../components/ui/Icon.js';
import { AnimatedNumber } from './AnimatedNumber.js';
import { formatListenDuration, formatListenDurationLong, formatNumber, staggerStyle } from './format.js';

function HeroStat({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-surface-container-high text-on-surface-variant">
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0">
        <p className="font-display text-2xl font-semibold tracking-tight text-on-surface tabular-nums">
          <AnimatedNumber value={value} />
        </p>
        <p className="mt-0.5 truncate text-xs text-on-surface-variant">{label}</p>
      </div>
    </div>
  );
}

export function HeroStats({ totals }: { totals: StatisticsTotals }) {
  const seconds = totals.totalDurationListened;
  return (
    <section
      aria-label="Listening summary"
      className="stat-reveal relative overflow-hidden rounded-card border border-outline bg-surface p-6 sm:p-8"
      style={staggerStyle(0)}
    >
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant">Listening time</p>
        {/* Solid foreground number — the app-wide rule is 600; this hero is
            the one deliberate 700 tier (design system exception). */}
        <p className="mt-3 font-display text-5xl font-bold tracking-tight text-on-surface tabular-nums sm:text-6xl">
          <AnimatedNumber value={seconds} formatter={formatListenDuration} />
        </p>
        <p className="mt-2 text-sm text-on-surface-variant">
          {formatListenDurationLong(seconds)}
          {totals.totalPlays > 0 ? ` across ${formatNumber(totals.totalPlays)} plays` : ''}
        </p>
        <div className="mt-8 grid grid-cols-1 gap-x-4 gap-y-5 border-t border-outline pt-6 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <HeroStat icon="mdi-play" label="Plays" value={totals.totalPlays} />
          <HeroStat icon="mdi-music" label="Favorite songs" value={totals.favoriteSongs} />
          <HeroStat icon="mdi-disc" label="Favorite albums" value={totals.favoriteAlbums} />
          <HeroStat icon="mdi-account-star" label="Favorite artists" value={totals.favoriteArtists} />
        </div>
      </div>
    </section>
  );
}
