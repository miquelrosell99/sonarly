import { Skeleton } from './ui/Skeleton.js';

// Suspense fallbacks for lazy routes. Each mirrors the shape of the real
// page it stands in for (same spacing rhythm as LibraryView / EntityDetail)
// so the transition from skeleton to content does not jump.

function SkeletonHeader() {
  return (
    <div className="mb-4 flex items-center justify-between">
      <Skeleton className="h-6 w-32" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-9 w-[76px] rounded-md" />
      </div>
    </div>
  );
}

export function ListPageSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div>
      <SkeletonHeader />
      <div role="status" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-4 border-b border-rule px-2">
            <Skeleton className="h-4 w-6 shrink-0" />
            <Skeleton className="h-4 w-1/3 min-w-32" />
            <Skeleton className="h-4 w-1/4 min-w-24" />
            <Skeleton className="h-4 w-1/4 min-w-24" />
            <Skeleton className="h-4 ml-auto w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GridPageSkeleton({ cards = 10 }: { cards?: number }) {
  return (
    <div>
      <SkeletonHeader />
      <div
        role="status"
        aria-label="Loading"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 p-1">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EntityDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="mb-6 flex items-end gap-6">
        <Skeleton className="h-40 w-40 shrink-0 rounded-xl md:h-48 md:w-48" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 pb-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-2/3 max-w-md" />
          <Skeleton className="h-4 w-1/3 max-w-56" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-10 w-24 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </div>
      </div>
      <div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-4 border-b border-rule px-2">
            <Skeleton className="h-4 w-6 shrink-0" />
            <Skeleton className="h-4 w-1/3 min-w-32" />
            <Skeleton className="h-4 w-1/4 min-w-24" />
            <Skeleton className="h-4 ml-auto w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="mb-6 h-6 w-40" />
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="mb-8 flex flex-col gap-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-2/3 max-w-lg" />
        </div>
      ))}
    </div>
  );
}
