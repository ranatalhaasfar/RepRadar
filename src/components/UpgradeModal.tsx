export function UpgradeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white/80 border border-black/10 rounded-2xl p-8 max-w-sm w-full text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-black/80 mb-2">Upgrade to Unlock</h2>
        <p className="text-sm text-black/30 mb-6 leading-relaxed">
          This feature is available on paid plans. Start your free trial to access AI insights,
          review fetching, competitor analysis, and more.
        </p>

        <div className="space-y-3 mb-6 text-left">
          <div className="bg-white/40 border border-emerald-300 rounded-xl p-4">
            <p className="font-semibold text-black/80">Starter — $29/month</p>
            <p className="text-xs text-black/30 mt-1">1 business · All features</p>
          </div>
          <div className="bg-white/40 border border-black/10 rounded-xl p-4">
            <p className="font-semibold text-black/80">Pro — $49/month</p>
            <p className="text-xs text-black/30 mt-1">3 businesses · Priority support</p>
          </div>
        </div>

        <button
          onClick={() => window.open('mailto:pajamapoems00@gmail.com?subject=RepRadar Upgrade Request', '_blank')}
          className="btn-primary w-full py-3 text-sm font-semibold mb-3"
        >
          Get Started →
        </button>
        <button
          onClick={onClose}
          className="text-sm text-black/30 hover:text-black/50 transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}
