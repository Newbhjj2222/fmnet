// pages/news.js

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from '../context/AuthContext';
import { db } from '../components/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import styles from './news.module.css';

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeString(value, fallback = '') {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value.name || value.title || value.label || value.id || fallback;
  }
  return String(value);
}

function timeAgo(date) {
  if (!date) return 'Just now';

  const now = new Date();
  const target = new Date(date);
  const diffMs = now.getTime() - target.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return target.toLocaleDateString();
}

function formatDate(date) {
  if (!date) return '-';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

function formatTime(date) {
  if (!date) return '-';
  try {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

/* =========================================================
   NEWS GENERATOR
========================================================= */

const NEWS_TEMPLATES = {
  match_result: {
    icon: '⚽',
    title: 'Match Result',
    color: '#38bdf8',
  },
  upcoming_match: {
    icon: '📅',
    title: 'Upcoming Fixture',
    color: '#f59e0b',
  },
  transfer: {
    icon: '🔄',
    title: 'Transfer News',
    color: '#22c55e',
  },
  loan: {
    icon: '📋',
    title: 'Loan Update',
    color: '#8b5cf6',
  },
  youth: {
    icon: '🌟',
    title: 'Youth Academy',
    color: '#ec4899',
  },
  finance: {
    icon: '💰',
    title: 'Financial News',
    color: '#f59e0b',
  },
  board: {
    icon: '👔',
    title: 'Board Update',
    color: '#6366f1',
  },
  injury: {
    icon: '🩹',
    title: 'Injury Report',
    color: '#ef4444',
  },
  achievement: {
    icon: '🏆',
    title: 'Achievement',
    color: '#fbbf24',
  },
  league: {
    icon: '📊',
    title: 'League Update',
    color: '#0ea5e9',
  },
  general: {
    icon: '📰',
    title: 'Club News',
    color: '#94a3b8',
  },
};

function generateMatchNews(matches, clubId, clubName) {
  const news = [];

  matches.forEach((match) => {
    const result = match.result || {};
    const homeScore = safeNumber(result.homeScore ?? match.homeScore);
    const awayScore = safeNumber(result.awayScore ?? match.awayScore);
    const isHome = match.homeClubId === clubId || match.homeTeamId === clubId;

    if (!isHome && match.awayClubId !== clubId && match.awayTeamId !== clubId) return;

    const opponent = isHome
      ? match.awayClubName || match.awayTeam || 'Opponent'
      : match.homeClubName || match.homeTeam || 'Opponent';

    const teamScore = isHome ? homeScore : awayScore;
    const opponentScore = isHome ? awayScore : homeScore;

    if (match.result || match.status === 'finished') {
      let headline = '';
      let body = '';

      if (teamScore > opponentScore) {
        headline = `${clubName} defeat ${opponent} ${teamScore}-${opponentScore}`;
        body = `${clubName} secured a convincing victory over ${opponent} in their latest fixture.`;
      } else if (teamScore < opponentScore) {
        headline = `${clubName} fall to ${opponent} ${teamScore}-${opponentScore}`;
        body = `${clubName} suffered a defeat against ${opponent} in a challenging encounter.`;
      } else {
        headline = `${clubName} draw ${teamScore}-${opponentScore} with ${opponent}`;
        body = `${clubName} and ${opponent} shared the points in a hard-fought draw.`;
      }

      news.push({
        id: `news-match-${match.id}`,
        type: 'match_result',
        icon: NEWS_TEMPLATES.match_result.icon,
        title: NEWS_TEMPLATES.match_result.title,
        color: NEWS_TEMPLATES.match_result.color,
        headline,
        body,
        date: match.date || new Date().toISOString(),
        matchId: match.id,
      });
    } else {
      news.push({
        id: `news-upcoming-${match.id}`,
        type: 'upcoming_match',
        icon: NEWS_TEMPLATES.upcoming_match.icon,
        title: NEWS_TEMPLATES.upcoming_match.title,
        color: NEWS_TEMPLATES.upcoming_match.color,
        headline: `${clubName} to face ${opponent}`,
        body: `Upcoming fixture: ${clubName} will take on ${opponent} at ${formatTime(match.date)}.`,
        date: new Date().toISOString(),
        matchId: match.id,
      });
    }
  });

  return news;
}

function generateTransferNews(players, clubId, clubName) {
  const news = [];

  players.forEach((player) => {
    const status = safeString(player.transferStatus || player.status, '').toLowerCase();

    if (status.includes('transfer') || status.includes('listed')) {
      news.push({
        id: `news-transfer-${player.id}`,
        type: 'transfer',
        icon: NEWS_TEMPLATES.transfer.icon,
        title: NEWS_TEMPLATES.transfer.title,
        color: NEWS_TEMPLATES.transfer.color,
        headline: `${player.name || player.fullName} transfer listed`,
        body: `${clubName} have placed ${player.name || player.fullName} on the transfer list with an asking price of €${safeNumber(player.askingPrice || player.marketValue).toLocaleString()}.`,
        date: player.transferListedAt || new Date().toISOString(),
      });
    }

    if (status.includes('loan')) {
      news.push({
        id: `news-loan-${player.id}`,
        type: 'loan',
        icon: NEWS_TEMPLATES.loan.icon,
        title: NEWS_TEMPLATES.loan.title,
        color: NEWS_TEMPLATES.loan.color,
        headline: `${player.name || player.fullName} available for loan`,
        body: `${clubName} have made ${player.name || player.fullName} available for a loan move to gain first-team experience.`,
        date: player.loanListedAt || new Date().toISOString(),
      });
    }
  });

  return news;
}

function generateYouthNews(youthPlayers, clubName) {
  const news = [];

  youthPlayers
    .filter((player) => player.isYouth === true || player.squadType === 'youth')
    .slice(0, 3)
    .forEach((player) => {
      news.push({
        id: `news-youth-${player.id}`,
        type: 'youth',
        icon: NEWS_TEMPLATES.youth.icon,
        title: NEWS_TEMPLATES.youth.title,
        color: NEWS_TEMPLATES.youth.color,
        headline: `Young talent ${player.name || player.fullName} emerges from academy`,
        body: `${clubName}'s youth academy has produced promising talent ${player.name || player.fullName} (${player.age || '?'} years old, OVR ${player.overall || '?'}, potential ${player.potential || '?'}).`,
        date: player.createdAt || new Date().toISOString(),
      });
    });

  return news;
}

function generateFinanceNews(clubInfo, careerData) {
  const news = [];

  if (clubInfo?.totalPrizeMoney || clubInfo?.prizeMoney) {
    const prize = safeNumber(clubInfo.totalPrizeMoney ?? clubInfo.prizeMoney);
    news.push({
      id: `news-prize-${clubInfo.id}`,
      type: 'finance',
      icon: NEWS_TEMPLATES.finance.icon,
      title: NEWS_TEMPLATES.finance.title,
      color: NEWS_TEMPLATES.finance.color,
      headline: `${clubInfo.name} receive €${prize.toLocaleString()} prize money`,
      body: `The club has been awarded prize money of €${prize.toLocaleString()} for their league performance this season.`,
      date: new Date().toISOString(),
    });
  }

  if (careerData?.lastWagePayment) {
    news.push({
      id: `news-wages-${Date.now()}`,
      type: 'finance',
      icon: NEWS_TEMPLATES.finance.icon,
      title: NEWS_TEMPLATES.finance.title,
      color: NEWS_TEMPLATES.finance.color,
      headline: `Monthly wages of €${safeNumber(careerData.lastWagePayment).toLocaleString()} paid`,
      body: `The club has paid out €${safeNumber(careerData.lastWagePayment).toLocaleString()} in player salaries this month.`,
      date: careerData.lastWagePaymentAt || new Date().toISOString(),
    });
  }

  return news;
}

function generateLeagueNews(clubInfo, stats) {
  const news = [];

  if (stats.matches > 0) {
    news.push({
      id: `news-league-position-${Date.now()}`,
      type: 'league',
      icon: NEWS_TEMPLATES.league.icon,
      title: NEWS_TEMPLATES.league.title,
      color: NEWS_TEMPLATES.league.color,
      headline: `${clubInfo?.name || 'Your club'} in league position ${stats.position || '-'}`,
      body: `Current standings show ${clubInfo?.name || 'your club'} with ${stats.points} points from ${stats.matches} matches (${stats.wins}W, ${stats.draws}D, ${stats.losses}L).`,
      date: new Date().toISOString(),
    });
  }

  return news;
}

/* =========================================================
   PAGE
========================================================= */

export default function NewsPage() {
  const router = useRouter();
  const { user, userData, loading } = useAuth();

  const [careerData, setCareerData] = useState(null);
  const [clubInfo, setClubInfo] = useState(null);
  const [matches, setMatches] = useState([]);
  const [players, setPlayers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      fetchNewsData();
    }
  }, [user, loading, router]);

  /* =======================================================
     SEASON YEAR
  ======================================================= */

  function getSeasonYear() {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  }

  /* =======================================================
     FETCH DATA
  ======================================================= */

  const fetchNewsData = async () => {
    try {
      setIsLoading(true);

      const userRef = doc(db, 'users', user.uid);
      const userSnapshot = await getDoc(userRef);

      let career = {};

      if (userSnapshot.exists()) {
        const data = userSnapshot.data();
        career = data.careerData || {};
        setCareerData(career);
      }

      if (career.currentClub) {
        const clubRef = doc(db, 'clubs', career.currentClub);
        const clubSnapshot = await getDoc(clubRef);

        if (clubSnapshot.exists()) {
          setClubInfo({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }

        // Load matches
        const matchesQuery = query(
          collection(db, 'matches'),
          where('seasonYear', '==', getSeasonYear())
        );

        const matchesSnapshot = await getDocs(matchesQuery);
        const matchList = [];

        matchesSnapshot.forEach((docItem) => {
          const match = docItem.data();

          const isClubMatch =
            match.homeClubId === career.currentClub ||
            match.awayClubId === career.currentClub ||
            match.homeTeamId === career.currentClub ||
            match.awayTeamId === career.currentClub;

          if (isClubMatch) {
            matchList.push({
              id: docItem.id,
              ...match,
            });
          }
        });

        setMatches(matchList);

        // Load players
        const playersQuery = query(
          collection(db, 'players'),
          where('clubId', '==', career.currentClub)
        );

        const playersSnapshot = await getDocs(playersQuery);
        const playerList = [];

        playersSnapshot.forEach((docItem) => {
          playerList.push({
            id: docItem.id,
            ...docItem.data(),
          });
        });

        setPlayers(playerList);
      }
    } catch (error) {
      console.error('Error fetching news data:', error);
      toast.error('Failed to load news');
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     GENERATE NEWS
  ======================================================= */

  const allNews = useMemo(() => {
    if (!clubInfo) return [];

    const clubName = clubInfo.name || 'Your Club';
    const clubId = clubInfo.id;

    const newsItems = [];

    // Match news
    newsItems.push(
      ...generateMatchNews(matches, clubId, clubName)
    );

    // Transfer/Loan news
    newsItems.push(
      ...generateTransferNews(players, clubId, clubName)
    );

    // Youth news
    const youthPlayers = players.filter(
      (player) => player.isYouth === true || player.squadType === 'youth'
    );
    newsItems.push(
      ...generateYouthNews(youthPlayers, clubName)
    );

    // Finance news
    newsItems.push(
      ...generateFinanceNews(clubInfo, careerData)
    );

    // League news
    const stats = {
      matches: safeNumber(careerData?.totalMatches),
      wins: safeNumber(careerData?.totalWins),
      draws: safeNumber(careerData?.totalDraws),
      losses: safeNumber(careerData?.totalLosses),
      points: safeNumber(careerData?.points),
      position: careerData?.currentPosition || '-',
    };
    newsItems.push(
      ...generateLeagueNews(clubInfo, stats)
    );

    // Board news
    if (careerData?.boardConfidence !== undefined) {
      const confidence = safeNumber(careerData.boardConfidence, 70);

      newsItems.push({
        id: `news-board-${Date.now()}`,
        type: 'board',
        icon: NEWS_TEMPLATES.board.icon,
        title: NEWS_TEMPLATES.board.title,
        color: NEWS_TEMPLATES.board.color,
        headline: `Board confidence at ${confidence}%`,
        body:
          confidence >= 70
            ? 'The board is very pleased with the club\'s progress under your management.'
            : confidence >= 50
              ? 'The board is generally satisfied but expects better results soon.'
              : 'The board is concerned about recent performances and results.',
        date: new Date().toISOString(),
      });
    }

    // Sort by date (newest first)
    newsItems.sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    return newsItems;
  }, [clubInfo, matches, players, careerData]);

  /* =======================================================
     FILTERED NEWS
  ======================================================= */

  const filteredNews = useMemo(() => {
    let result = allNews;

    if (activeFilter !== 'all') {
      result = result.filter((item) => item.type === activeFilter);
    }

    if (searchTerm.trim()) {
      const search = searchTerm.trim().toLowerCase();
      result = result.filter(
        (item) =>
          (item.headline || '').toLowerCase().includes(search) ||
          (item.body || '').toLowerCase().includes(search)
      );
    }

    return result;
  }, [allNews, activeFilter, searchTerm]);

  /* =======================================================
     FILTER TYPES
  ======================================================= */

  const filterTypes = useMemo(() => {
    const types = new Set(allNews.map((item) => item.type));

    return [
      { value: 'all', label: 'All News', icon: '📰' },
      ...Array.from(types).map((type) => ({
        value: type,
        label: NEWS_TEMPLATES[type]?.title || type,
        icon: NEWS_TEMPLATES[type]?.icon || '📰',
      })),
    ];
  }, [allNews]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading news feed...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>News Feed - Virtual Football Manager</title>
        <meta
          name="description"
          content="Latest football news, match results, transfers, and club updates."
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>CLUB COMMUNICATIONS</span>
            <h1>News Feed</h1>
            <p>
              Latest updates from {clubInfo?.name || 'your club'} and around
              the football world.
            </p>
          </div>

          <div className={styles.newsCount}>
            <strong>{allNews.length}</strong>
            <span>Stories</span>
          </div>
        </header>

        {/* SEARCH */}
        <section className={styles.searchSection}>
          <div className={styles.searchBox}>
            <span>🔎</span>
            <input
              type="text"
              placeholder="Search news..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </section>

        {/* FILTERS */}
        <nav className={styles.filters}>
          {filterTypes.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={
                activeFilter === filter.value ? styles.activeFilter : ''
              }
              onClick={() => setActiveFilter(filter.value)}
            >
              <span>{filter.icon}</span>
              {filter.label}
            </button>
          ))}
        </nav>

        {/* NEWS LIST */}
        <section className={styles.newsList}>
          {filteredNews.length > 0 ? (
            filteredNews.map((news, index) => (
              <article
                key={news.id}
                className={styles.newsCard}
                style={{
                  borderLeftColor: news.color,
                }}
              >
                <div className={styles.newsIcon} style={{ background: `${news.color}15` }}>
                  <span>{news.icon}</span>
                </div>

                <div className={styles.newsContent}>
                  <div className={styles.newsHeader}>
                    <span
                      className={styles.newsType}
                      style={{ color: news.color }}
                    >
                      {news.title}
                    </span>
                    <span className={styles.newsTime}>
                      {timeAgo(news.date)}
                    </span>
                  </div>

                  <h2 className={styles.newsHeadline}>{news.headline}</h2>
                  <p className={styles.newsBody}>{news.body}</p>

                  <div className={styles.newsFooter}>
                    <span>{formatDate(news.date)}</span>
                    <span>{formatTime(news.date)}</span>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className={styles.emptyState}>
              <span>📰</span>
              <h3>No news found</h3>
              <p>There are no news stories matching your filters.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
