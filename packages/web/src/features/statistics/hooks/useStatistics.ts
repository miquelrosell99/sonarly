import { useQuery } from '@tanstack/react-query';
import type {
  MonthlyGroupedPlaysItem,
  MonthlyPlaysGroupBy,
  OverallStatistics,
  StatisticsTimeRange,
  UserStatistics,
} from '@sonarly/shared';
import { api } from '../../../api.js';

export type StatisticsMode = 'me' | 'overall' | 'user';

export function useStatistics(
  mode: StatisticsMode,
  userId: string | undefined,
  range: StatisticsTimeRange,
  enabled = true,
) {
  return useQuery<UserStatistics | OverallStatistics>({
    queryKey: ['statistics', mode, userId, range],
    queryFn: async () => {
      if (mode === 'me') {
        return api<UserStatistics>(`/statistics/me?range=${range}`);
      }
      if (mode === 'overall') {
        return api<OverallStatistics>(`/statistics/overall?range=${range}`);
      }
      if (mode === 'user' && userId) {
        return api<UserStatistics>(`/statistics/users/${userId}?range=${range}`);
      }
      throw new Error('Invalid statistics mode');
    },
    enabled: enabled && (mode !== 'user' || !!userId),
  });
}

export function useMonthlyGroupedPlays(
  mode: StatisticsMode,
  userId: string | undefined,
  range: StatisticsTimeRange,
  groupBy: MonthlyPlaysGroupBy,
  enabled = true,
) {
  return useQuery<{ data: MonthlyGroupedPlaysItem[] }>({
    queryKey: ['statistics', 'monthly-grouped', mode, userId, range, groupBy],
    queryFn: async () => {
      if (mode === 'me') {
        return api<{ data: MonthlyGroupedPlaysItem[] }>(`/statistics/me/monthly-grouped?range=${range}&groupBy=${groupBy}`);
      }
      if (mode === 'user' && userId) {
        return api<{ data: MonthlyGroupedPlaysItem[] }>(`/statistics/users/${userId}/monthly-grouped?range=${range}&groupBy=${groupBy}`);
      }
      throw new Error('Invalid statistics mode');
    },
    enabled: enabled && (mode === 'me' || !!userId),
  });
}
