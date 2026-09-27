import { useState } from 'react';
import type { StatisticsTimeRange } from '../../../types';
import { useStatistics } from '../hooks/useStatistics.js';
import { StatisticsView } from '../components/StatisticsView.js';

// The only route is /statistics, always mode "me". The overall/user modes
// stay in the hooks for admin consumers (AdminUsers), but no page route ever
// passes another mode or a userId (audit F29) — so this page takes no props.
export function StatisticsPage() {
  const [range, setRange] = useState<StatisticsTimeRange>('all');
  const { data, isLoading, error } = useStatistics('me', undefined, range);

  return (
    <div className="space-y-6">
      <StatisticsView
        data={data}
        range={range}
        onRangeChange={setRange}
        title="Your Statistics"
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}
