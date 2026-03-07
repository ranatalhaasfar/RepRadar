// ── Reputation Score ──────────────────────────────────────────────
export const reputationScore = 87

// ── 30-day Sentiment Data ─────────────────────────────────────────
function generateSentimentData() {
  const data = []
  const now = new Date()
  let positive = 72
  let negative = 28
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    positive = Math.min(95, Math.max(55, positive + (Math.random() - 0.45) * 5))
    negative = 100 - positive
    data.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      positive: Math.round(positive),
      negative: Math.round(negative),
    })
  }
  return data
}
export const sentimentData = generateSentimentData()

// ── Quick Stats ───────────────────────────────────────────────────
export const quickStats = {
  totalReviews: 1284,
  avgRating: 4.3,
  positivePercent: 78,
  needsAttention: 22,
  newThisWeek: 34,
  responseRate: 91,
}

// ── Recent Reviews ────────────────────────────────────────────────
export type Review = {
  id: number
  author: string
  platform: 'Google' | 'Yelp' | 'TripAdvisor' | 'Facebook'
  rating: number
  text: string
  date: string
  responded: boolean
}

export const recentReviews: Review[] = [
  {
    id: 1,
    author: 'Sarah M.',
    platform: 'Google',
    rating: 5,
    text: 'Absolutely loved my experience here! The staff was incredibly helpful and the atmosphere was perfect. Will definitely be coming back.',
    date: '2 hours ago',
    responded: false,
  },
  {
    id: 2,
    author: 'James T.',
    platform: 'Yelp',
    rating: 2,
    text: 'Waited over 45 minutes for my order with no updates. When I asked the staff they seemed indifferent. Food was fine but service ruined it.',
    date: '5 hours ago',
    responded: false,
  },
  {
    id: 3,
    author: 'Linda K.',
    platform: 'Google',
    rating: 4,
    text: 'Great food and cozy atmosphere. The only reason I\'m not giving 5 stars is the parking situation — it can be tough on weekends.',
    date: '1 day ago',
    responded: true,
  },
  {
    id: 4,
    author: 'Marcus R.',
    platform: 'TripAdvisor',
    rating: 5,
    text: 'One of the best hidden gems in town. Came in on a whim and was blown away. The owner personally checked in on our table.',
    date: '2 days ago',
    responded: true,
  },
  {
    id: 5,
    author: 'Priya N.',
    platform: 'Facebook',
    rating: 1,
    text: 'Extremely disappointed. The item I ordered was not what was described on the menu and when I raised it I was made to feel like the problem.',
    date: '3 days ago',
    responded: false,
  },
]

// ── Competitors ───────────────────────────────────────────────────
export type Competitor = {
  name: string
  rating: number
  reviewCount: number
  trend: 'up' | 'down' | 'flat'
  trendValue: string
}

export const defaultCompetitors: Competitor[] = [
  { name: 'The Corner Bistro', rating: 4.1, reviewCount: 892, trend: 'down', trendValue: '-0.2' },
  { name: 'Main Street Cafe',  rating: 4.5, reviewCount: 2341, trend: 'up', trendValue: '+0.3' },
  { name: 'Harborview Grill',  rating: 3.8, reviewCount: 567, trend: 'flat', trendValue: '0.0' },
]

export const yourBusiness = { name: 'Your Business', rating: 4.3, reviewCount: 1284 }

// ── AI Insights ───────────────────────────────────────────────────
export type Insight = {
  id: number
  icon: string
  category: 'Service' | 'Food' | 'Pricing' | 'Ambiance' | 'Trending' | 'Opportunity'
  title: string
  description: string
  recommendation: string
  impact: 'High' | 'Medium' | 'Low'
}

export const insights: Insight[] = [
  {
    id: 1,
    icon: '🕐',
    category: 'Service',
    title: '"Slow service" spikes on Friday evenings',
    description: 'Reviews mentioning wait times are 3× higher on Fridays between 6–9pm compared to other days.',
    recommendation: 'Consider adding one additional staff member on Friday evening shifts to reduce wait times.',
    impact: 'High',
  },
  {
    id: 2,
    icon: '⭐',
    category: 'Trending',
    title: 'Cleanliness score up 12% this month',
    description: 'Positive mentions of cleanliness and hygiene have increased significantly over the past 30 days.',
    recommendation: 'Highlight your hygiene standards in your listing and continue current cleaning protocols.',
    impact: 'Medium',
  },
  {
    id: 3,
    icon: '💰',
    category: 'Pricing',
    title: 'Price sensitivity rising among new customers',
    description: '18% of new reviewer complaints mention value for money — up from 11% last month.',
    recommendation: 'Consider introducing a weekday lunch special or loyalty discount to retain price-sensitive customers.',
    impact: 'High',
  },
  {
    id: 4,
    icon: '🎉',
    category: 'Opportunity',
    title: 'Birthday & anniversary visits going unacknowledged',
    description: '9 recent reviewers mentioned celebrating a special occasion — none received a personalized response.',
    recommendation: 'Create a response template for celebration reviews to turn these into loyal advocates.',
    impact: 'Medium',
  },
  {
    id: 5,
    icon: '🍽️',
    category: 'Food',
    title: '"Pasta dishes" are your most praised menu item',
    description: 'The word "pasta" appears in 34% of 5-star reviews this month — your highest keyword.',
    recommendation: 'Feature pasta dishes prominently in your social media and Google listing photos.',
    impact: 'Low',
  },
  {
    id: 6,
    icon: '📍',
    category: 'Ambiance',
    title: 'Parking complaints up 20% vs last quarter',
    description: 'Parking difficulty is now the #2 recurring complaint after wait times.',
    recommendation: 'Add parking guidance to your Google listing and confirmation emails to reduce friction.',
    impact: 'Medium',
  },
]
