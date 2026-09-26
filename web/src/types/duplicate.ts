export const DUPLICATE_STRATEGIES = [
  'replace_file_and_metadata',
  'keep_file_replace_metadata',
  'replace_file_aggregate_metadata',
  'keep_file_aggregate_metadata',
  'skip',
] as const;

export type DuplicateStrategy = (typeof DUPLICATE_STRATEGIES)[number];

export const DUPLICATE_STRATEGY_LABELS: Record<DuplicateStrategy, string> = {
  replace_file_and_metadata: 'Replace file and metadata',
  keep_file_replace_metadata: 'Keep file, replace metadata',
  replace_file_aggregate_metadata: 'Replace file, aggregate metadata',
  keep_file_aggregate_metadata: 'Keep file, aggregate metadata',
  skip: 'Skip duplicate',
};

export function isDuplicateStrategy(value: unknown): value is DuplicateStrategy {
  return typeof value === 'string' && (DUPLICATE_STRATEGIES as readonly string[]).includes(value);
}
