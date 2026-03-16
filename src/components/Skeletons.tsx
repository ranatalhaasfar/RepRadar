function SkeletonBlock({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />
}

export function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      {[0,1,2,3].map(i => (
        <div key={i} className="glass-card p-5 space-y-3">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="w-9 h-9 rounded-[12px]" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-7 w-20" />
              <SkeletonBlock className="h-3 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function KeywordsSkeleton() {
  return (
    <div className="glass-card p-6 space-y-4">
      <SkeletonBlock className="h-3 w-40" />
      <div className="flex flex-wrap gap-2">
        {[80,60,90,50,70,55,85,65].map((w, i) => (
          <SkeletonBlock key={i} className="h-7 rounded-full" style={{ width: `${w}px` }} />
        ))}
      </div>
    </div>
  )
}

export function CategoryTabsSkeleton() {
  return (
    <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-none">
      {[0,1,2,3].map(i => (
        <SkeletonBlock key={i} className="w-[160px] h-24 rounded-xl flex-shrink-0" />
      ))}
    </div>
  )
}

export function ReviewListSkeleton() {
  return (
    <div className="space-y-0 divide-y divide-black/5">
      {[0,1,2].map(i => (
        <div key={i} className="px-5 py-4 flex items-start gap-3.5">
          <SkeletonBlock className="w-9 h-9 rounded-[12px] flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-32" />
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function InsightCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {[0,1,2,3].map(i => (
        <div key={i} className="glass-card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <SkeletonBlock className="w-8 h-8 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-3 w-full" />
            </div>
          </div>
          <SkeletonBlock className="h-3 w-full" />
          <SkeletonBlock className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="space-y-2">
        <SkeletonBlock className="h-8 w-64" />
        <SkeletonBlock className="h-4 w-40" />
      </div>
      <StatCardsSkeleton />
      <KeywordsSkeleton />
      <ReviewListSkeleton />
    </div>
  )
}
