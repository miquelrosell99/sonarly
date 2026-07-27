import { useState } from 'react';
import type { StatisticsTimeRange } from '@sonarly/shared';
import { useStatistics, type StatisticsMode } from '../hooks/useStatistics.js';
import { StatisticsView } from '../components/StatisticsView.js';

interface StatisticsPageProps {
  mode: StatisticsMode;
  userId?: string;
  title?: string;
  subtitle?: string;
}

export function StatisticsPage({ mode, userId, title, subtitle }: StatisticsPageProps) {
  const [range, setRange] = useState<StatisticsTimeRange>('all');
  const { data, isLoading, error } = useStatistics(mode, userId, range);

  return (
    <div className="space-y-6 p-6">
      <StatisticsView
        data={data}
        range={range}
        onRangeChange={setRange}
        title={title ?? (mode === 'overall' ? 'Overall Statistics' : 'Your Statistics')}
        subtitle={subtitle}
        isLoading={isLoading}
        error={error}
        mode={mode}
        userId={userId}
      />
    </div>
  );
}
