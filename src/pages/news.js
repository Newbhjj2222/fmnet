import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useRouter } from 'next/router';
import Head from 'next/head';

import { useAuth } from '../context/AuthContext';
import { db } from '../components/firebase';

import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import toast from 'react-hot-toast';
import styles from './news.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const MAX_NEWS = 100;
const MAX_POSTS = 50;
const MAX_COMMENTS = 30;

const AI_MIN_LIKE_DELAY = 45000;
const AI_MAX_LIKE_DELAY = 180000;

const POST_COOLDOWN = 5000;

const MEDIA_OUTLETS = [
  {
    id: 'football_world_tv',
    name: 'Football World TV',
    shortName: 'FWTV',
    icon: '📺',
    color: '#38bdf8',
    type: 'Television',
  },
  {
    id: 'global_football_daily',
    name: 'Global Football Daily',
    shortName: 'GFD',
    icon: '📰',
    color: '#f59e0b',
    type: 'Newspaper',
  },
  {
    id: 'football_insider',
    name: 'Football Insider',
    shortName: 'FI',
    icon: '🎙️',
    color: '#22c55e',
    type: 'Media',
  },
  {
    id: 'stadium_press',
    name: 'The Stadium Press',
    shortName: 'TSP',
    icon: '🏟️',
    color: '#ef4444',
    type: 'Newspaper',
  },
  {
    id: 'football_focus',
    name: 'Football Focus',
    shortName: 'FF',
    icon: '🎥',
    color: '#8b5cf6',
    type: 'Television',
  },
  {
    id: 'transfer_central',
    name: 'Transfer Central',
    shortName: 'TC',
    icon: '🔄',
    color: '#ec4899',
    type: 'Transfer Media',
  },
];

const AI_PERSONAS = [
  {
    id: 'ai-john',
    name: 'John Football',
    avatar: '👨🏾‍💼',
  },
  {
    id: 'ai-marc',
    name: 'Marc Analyst',
    avatar: '🧠',
  },
  {
    id: 'ai-david',
    name: 'David Fan',
    avatar: '⚽',
  },
  {
    id: 'ai-sarah',
    name: 'Sarah Sports',
    avatar: '🎙️',
  },
  {
    id: 'ai-alex',
    name: 'Alex Reporter',
    avatar: '📰',
  },
];

/* =========================================================
   NEWS TEMPLATES
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

  injury: {
    icon: '🩹',
    title: 'Injury Report',
    color: '#ef4444',
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

  interview: {
    icon: '🎤',
    title: 'Exclusive Interview',
    color: '#a855f7',
  },

  media: {
    icon: '📺',
    title: 'Media Report',
    color: '#14b8a6',
  },

  general: {
    icon: '📰',
    title: 'Club News',
    color: '#94a3b8',
  },
};

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    Number.isNaN(Number(value))
  ) {
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
    return (
      value.name ||
      value.title ||
      value.label ||
      value.displayName ||
      value.id ||
      fallback
    );
  }

  return String(value);
}

function getPlayerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    player?.displayName ||
    `${player?.firstName || ''} ${player?.lastName || ''}`.trim() ||
    'Unknown Player'
  );
}

function getPlayerPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    'MID'
  );
}

function getPlayerOverall(player) {
  return safeNumber(
    player?.overall ??
      player?.rating ??
      player?.overallRating,
    0
  );
}

function toDate(value) {
  if (!value) return null;

  if (
    typeof value === 'object' &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate();
  }

  if (
    typeof value === 'object' &&
    typeof value.seconds === 'number'
  ) {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function timeAgo(value) {
  const date = toDate(value);

  if (!date) {
    return 'Just now';
  }

  const now = new Date();

  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) {
    return 'Upcoming';
  }

  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'Just now';

  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }

  if (diffDay < 7) {
    return `${diffDay}d ago`;
  }

  return date.toLocaleDateString();
}

function formatDate(value) {
  const date = toDate(value);

  if (!date) return '-';

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(value) {
  const date = toDate(value);

  if (!date) return '-';

  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(value) {
  return safeNumber(value).toLocaleString();
}

function getTimestampValue(value) {
  const date = toDate(value);

  return date ? date.getTime() : 0;
}

function getRandomItem(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/* =========================================================
   SEASON
========================================================= */

function getSeasonYear() {
  const now = new Date();

  return now.getMonth() >= 6
    ? now.getFullYear()
    : now.getFullYear() - 1;
}

/* =========================================================
   MATCH NEWS
========================================================= */

function generateMatchNews(matches, clubId, clubName) {
  const news = [];

  matches.forEach((match) => {
    const result = match.result || {};

    const homeScore = safeNumber(
      result.homeScore ?? match.homeScore
    );

    const awayScore = safeNumber(
      result.awayScore ?? match.awayScore
    );

    const isHome =
      match.homeClubId === clubId ||
      match.homeTeamId === clubId;

    const isAway =
      match.awayClubId === clubId ||
      match.awayTeamId === clubId;

    if (!isHome && !isAway) {
      return;
    }

    const opponent = isHome
      ? safeString(
          match.awayClubName ??
            match.awayTeam ??
            match.awayName,
          'Opponent'
        )
      : safeString(
          match.homeClubName ??
            match.homeTeam ??
            match.homeName,
          'Opponent'
        );

    const teamScore = isHome
      ? homeScore
      : awayScore;

    const opponentScore = isHome
      ? awayScore
      : homeScore;

    const isFinished =
      match.status === 'finished' ||
      match.finished === true ||
      Boolean(match.result);

    if (isFinished) {
      let headline;
      let body;

      if (teamScore > opponentScore) {
        headline =
          `${clubName} defeat ${opponent} ${teamScore}-${opponentScore}`;

        body =
          `${clubName} secured three points after beating ${opponent} ${teamScore}-${opponentScore}.`;
      } else if (teamScore < opponentScore) {
        headline =
          `${clubName} lose to ${opponent} ${teamScore}-${opponentScore}`;

        body =
          `${clubName} suffered defeat against ${opponent} in their latest fixture.`;
      } else {
        headline =
          `${clubName} draw ${teamScore}-${opponentScore} with ${opponent}`;

        body =
          `${clubName} and ${opponent} shared the points after a ${teamScore}-${opponentScore} draw.`;
      }

      news.push({
        id: `news-match-${match.id}`,
        type: 'match_result',
        icon: NEWS_TEMPLATES.match_result.icon,
        title: NEWS_TEMPLATES.match_result.title,
        color: NEWS_TEMPLATES.match_result.color,
        headline,
        body,
        date:
          match.finishedAt ||
          match.date ||
          new Date().toISOString(),
        matchId: match.id,
      });
    } else {
      news.push({
        id: `news-upcoming-${match.id}`,
        type: 'upcoming_match',
        icon: NEWS_TEMPLATES.upcoming_match.icon,
        title: NEWS_TEMPLATES.upcoming_match.title,
        color: NEWS_TEMPLATES.upcoming_match.color,
        headline:
          `${clubName} to face ${opponent}`,
        body:
          `Upcoming fixture between ${clubName} and ${opponent}.`,
        date:
          match.date ||
          new Date().toISOString(),
        matchId: match.id,
      });
    }
  });

  return news;
}

/* =========================================================
   TRANSFER NEWS
========================================================= */

function generateTransferNews(players, clubId, clubName) {
  const news = [];

  players.forEach((player) => {
    const name = getPlayerName(player);

    const status = safeString(
      player.transferStatus ||
        player.status ||
        player.transferState,
      ''
    ).toLowerCase();

    const isListed =
      player.transferListed === true ||
      status.includes('listed') ||
      status.includes('transfer');

    const isCompleted =
      player.transferCompleted === true ||
      status.includes('completed') ||
      status.includes('sold');

    const transferTo =
      player.transferToClubName ||
      player.toClubName ||
      player.newClubName ||
      'another club';

    const transferFrom =
      player.transferFromClubName ||
      player.fromClubName ||
      'another club';

    if (isCompleted) {
      const fee =
        player.transferFee ??
        player.fee ??
        player.transferAmount ??
        player.askingPrice;

      news.push({
        id: `news-transfer-completed-${player.id}`,
        type: 'transfer',
        icon: NEWS_TEMPLATES.transfer.icon,
        title: NEWS_TEMPLATES.transfer.title,
        color: NEWS_TEMPLATES.transfer.color,
        headline:
          `${name} completes transfer to ${transferTo}`,
        body:
          `${clubName} have completed the transfer of ${name} for €${formatMoney(fee)}.`,
        date:
          player.transferCompletedAt ||
          player.updatedAt ||
          new Date().toISOString(),
        playerId: player.id,
      });

      return;
    }

    if (isListed) {
      const askingPrice =
        player.askingPrice ??
        player.transferFee ??
        player.marketValue ??
        0;

      news.push({
        id: `news-transfer-listed-${player.id}`,
        type: 'transfer',
        icon: NEWS_TEMPLATES.transfer.icon,
        title: NEWS_TEMPLATES.transfer.title,
        color: NEWS_TEMPLATES.transfer.color,
        headline:
          `${name} placed on the transfer list`,
        body:
          `${clubName} are listening to offers for ${name}. Current asking price: €${formatMoney(askingPrice)}.`,
        date:
          player.transferListedAt ||
          player.updatedAt ||
          new Date().toISOString(),
        playerId: player.id,
      });
    }

    const isLoan =
      player.loanListed === true ||
      status.includes('loan');

    if (isLoan) {
      news.push({
        id: `news-loan-${player.id}`,
        type: 'loan',
        icon: NEWS_TEMPLATES.loan.icon,
        title: NEWS_TEMPLATES.loan.title,
        color: NEWS_TEMPLATES.loan.color,
        headline:
          `${name} available for loan`,
        body:
          `${clubName} are open to loan offers for ${name} to gain regular first-team experience.`,
        date:
          player.loanListedAt ||
          player.updatedAt ||
          new Date().toISOString(),
        playerId: player.id,
      });
    }

    if (
      player.transferOfferReceived === true ||
      player.hasTransferOffer === true
    ) {
      const offer =
        player.transferOfferAmount ??
        player.offerAmount ??
        0;

      const fromClub =
        player.offerFromClubName ||
        player.interestedClubName ||
        'an interested club';

      news.push({
        id: `news-transfer-offer-${player.id}`,
        type: 'transfer',
        icon: '💼',
        title: 'Transfer Offer',
        color: '#10b981',
        headline:
          `${fromClub} make offer for ${name}`,
        body:
          `${fromClub} have submitted an offer of €${formatMoney(offer)} for ${name}.`,
        date:
          player.transferOfferAt ||
          player.updatedAt ||
          new Date().toISOString(),
        playerId: player.id,
      });
    }
  });

  return news;
}

/* =========================================================
   INJURY NEWS
========================================================= */

function generateInjuryNews(players, clubName) {
  const news = [];

  players.forEach((player) => {
    const name = getPlayerName(player);

    const injured =
      player.injured === true ||
      player.isInjured === true ||
      player.injuryStatus === 'injured' ||
      Boolean(player.injury);

    if (!injured) {
      return;
    }

    const injuryName =
      player.injuryName ||
      player.injuryType ||
      player.injury ||
      'an injury';

    const days =
      player.injuryDaysRemaining ??
      player.daysOut ??
      player.injuryDuration ??
      null;

    let recoveryText = '';

    if (days !== null) {
      recoveryText =
        ` Estimated recovery time: ${safeNumber(days)} day(s).`;
    }

    news.push({
      id: `news-injury-${player.id}`,
      type: 'injury',
      icon: NEWS_TEMPLATES.injury.icon,
      title: NEWS_TEMPLATES.injury.title,
      color: NEWS_TEMPLATES.injury.color,
      headline:
        `${name sidelined with ${injuryName}`,
      body:
        `${clubName} will be without ${name} while the player recovers from ${injuryName}.${recoveryText}`,
      date:
        player.injuryReportedAt ||
        player.injuredAt ||
        player.updatedAt ||
        new Date().toISOString(),
      playerId: player.id,
    });
  });

  return news;
}

/* =========================================================
   YOUTH NEWS
========================================================= */

function generateYouthNews(players, clubName) {
  return players
    .filter(
      (player) =>
        player.isYouth === true ||
        player.squadType === 'youth'
    )
    .slice(0, 5)
    .map((player) => {
      const name = getPlayerName(player);

      return {
        id: `news-youth-${player.id}`,
        type: 'youth',
        icon: NEWS_TEMPLATES.youth.icon,
        title: NEWS_TEMPLATES.youth.title,
        color: NEWS_TEMPLATES.youth.color,
        headline:
          `Young talent ${name} attracts attention`,
        body:
          `${clubName}'s academy prospect ${name} is showing promise with an OVR of ${getPlayerOverall(player)} and potential of ${safeNumber(player.potential, '?')}.`,
        date:
          player.createdAt ||
          player.updatedAt ||
          new Date().toISOString(),
        playerId: player.id,
      };
    });
}

/* =========================================================
   FINANCE NEWS
========================================================= */

function generateFinanceNews(clubInfo, careerData) {
  const news = [];

  if (
    clubInfo?.totalPrizeMoney !== undefined ||
    clubInfo?.prizeMoney !== undefined
  ) {
    const prize = safeNumber(
      clubInfo.totalPrizeMoney ??
        clubInfo.prizeMoney
    );

    if (prize > 0) {
      news.push({
        id: `news-prize-${clubInfo.id}`,
        type: 'finance',
        icon: NEWS_TEMPLATES.finance.icon,
        title: NEWS_TEMPLATES.finance.title,
        color: NEWS_TEMPLATES.finance.color,
        headline:
          `${clubInfo.name || 'The club'} receive €${formatMoney(prize)} prize money`,
        body:
          `The club has received prize money of €${formatMoney(prize)} for its competition performance.`,
        date:
          clubInfo.prizeMoneyAt ||
          clubInfo.updatedAt ||
          new Date().toISOString(),
      });
    }
  }

  if (careerData?.lastWagePayment) {
    news.push({
      id: `news-wages-${careerData.lastWagePaymentAt || 'latest'}`,
      type: 'finance',
      icon: NEWS_TEMPLATES.finance.icon,
      title: NEWS_TEMPLATES.finance.title,
      color: NEWS_TEMPLATES.finance.color,
      headline:
        `Monthly wages of €${formatMoney(careerData.lastWagePayment)} paid`,
      body:
        `The club has processed its latest player wage payment.`,
      date:
        careerData.lastWagePaymentAt ||
        new Date().toISOString(),
    });
  }

  return news;
}

/* =========================================================
   LEAGUE NEWS
========================================================= */

function generateLeagueNews(clubInfo, careerData) {
  const matches = safeNumber(careerData?.totalMatches);

  if (matches <= 0) {
    return [];
  }

  const wins = safeNumber(careerData?.totalWins);
  const draws = safeNumber(careerData?.totalDraws);
  const losses = safeNumber(careerData?.totalLosses);
  const points = safeNumber(careerData?.points);

  return [
    {
      id: `news-league-${careerData?.currentPosition || 'current'}`,
      type: 'league',
      icon: NEWS_TEMPLATES.league.icon,
      title: NEWS_TEMPLATES.league.title,
      color: NEWS_TEMPLATES.league.color,
      headline:
        `${clubInfo?.name || 'Your club'} currently sit ${careerData?.currentPosition || '-'} in the league`,
      body:
        `${clubInfo?.name || 'Your club'} have ${points} points from ${matches} matches: ${wins} wins, ${draws} draws and ${losses} defeats.`,
      date:
        careerData?.lastMatchAt ||
        new Date().toISOString(),
    },
  ];
}

/* =========================================================
   MEDIA GENERATOR
========================================================= */

function generateMediaReports({
  clubInfo,
  careerData,
  players,
  matches,
}) {
  const clubName = clubInfo?.name || 'Your Club';

  const media = [];

  const outlet =
    getRandomItem(MEDIA_OUTLETS) ||
    MEDIA_OUTLETS[0];

  if (players.length > 0) {
    const player =
      [...players].sort(
        (a, b) =>
          getPlayerOverall(b) -
          getPlayerOverall(a)
      )[0];

    media.push({
      id: `media-player-${player.id}`,
      type: 'media',
      icon: outlet.icon,
      title: outlet.name,
      color: outlet.color,
      headline:
        `${outlet.name}: ${getPlayerName(player)} becoming one to watch`,
      body:
        `${outlet.name} are monitoring ${getPlayerName(player)} after a series of promising performances for ${clubName}.`,
      date: new Date().toISOString(),
      mediaOutletId: outlet.id,
    });
  }

  if (matches.length > 0) {
    const latest =
      [...matches].sort(
        (a, b) =>
          getTimestampValue(b.date) -
          getTimestampValue(a.date)
      )[0];

    const opponent =
      latest?.homeClubId === clubInfo?.id
        ? latest?.awayClubName ||
          latest?.awayTeam ||
          'the opposition'
        : latest?.homeClubName ||
          latest?.homeTeam ||
          'the opposition';

    media.push({
      id: `media-match-${latest.id}`,
      type: 'media',
      icon: '📺',
      title: 'Football World TV',
      color: '#38bdf8',
      headline:
        `Football World TV: ${clubName} under the spotlight`,
      body:
        `Our analysts are reviewing ${clubName}'s latest fixture against ${opponent} and the manager's tactical decisions.`,
      date:
        latest.date ||
        new Date().toISOString(),
      mediaOutletId: 'football_world_tv',
    });
  }

  if (
    careerData?.boardConfidence !== undefined
  ) {
    const confidence = safeNumber(
      careerData.boardConfidence,
      70
    );

    media.push({
      id: `media-board-${confidence}`,
      type: 'media',
      icon: '🎙️',
      title: 'Football Insider',
      color: '#22c55e',
      headline:
        `Football Insider analyse ${clubName}'s project`,
      body:
        `With board confidence currently at ${confidence}%, media analysts are debating whether the club is moving in the right direction.`,
      date: new Date().toISOString(),
      mediaOutletId: 'football_insider',
    });
  }

  return media;
}

/* =========================================================
   INTERVIEW GENERATOR
========================================================= */

function generateInterview({
  clubInfo,
  careerData,
  players,
}) {
  const clubName = clubInfo?.name || 'Your Club';

  const player =
    getRandomItem(players) || null;

  const confidence = safeNumber(
    careerData?.boardConfidence,
    70
  );

  const questions = [
    `Your team has been under pressure recently. How do you assess the current situation?`,
    `What are your priorities for the next part of the season?`,
    `The supporters want results. What message do you have for them?`,
    `Are you satisfied with the development of the squad?`,
    `Will the club be active in the transfer market?`,
    `How important is squad depth for your current campaign?`,
  ];

  const question =
    getRandomItem(questions);

  let answer;

  if (confidence >= 75) {
    answer =
      `We are happy with the direction of the team. There is still work to do, but the players are responding well and we want to keep improving.`;
  } else if (confidence >= 50) {
    answer =
      `We know there are areas we need to improve. The important thing is to stay focused, work together and respond on the pitch.`;
  } else {
    answer =
      `We understand the concerns. The responsibility is ours, and we have to find solutions quickly and give the supporters something to believe in.`;
  }

  return {
    id: `interview-${Date.now()}`,
    type: 'interview',
    icon: NEWS_TEMPLATES.interview.icon,
    title: getRandomItem(MEDIA_OUTLETS)?.name ||
      'Football Insider',
    color: NEWS_TEMPLATES.interview.color,
    headline:
      `${clubName} manager speaks to the media`,
    body:
      `🎤 Interview question: "${question}"\n\nManager: "${answer}"`,
    date: new Date().toISOString(),
    featuredPlayerId: player?.id || null,
  };
}

/* =========================================================
   AI COMMENT GENERATOR
========================================================= */

function generateAIComment({
  post,
  clubInfo,
}) {
  const text = safeString(
    post.content,
    ''
  ).toLowerCase();

  const clubName =
    clubInfo?.name || 'the club';

  if (
    text.includes('transfer') ||
    text.includes('sign') ||
    text.includes('player')
  ) {
    return getRandomItem([
      `Interesting transfer development. ${clubName} need to get this decision right.`,
      `This could become one of the most important moves of the season.`,
      `The transfer market is getting interesting. I want to see how this develops.`,
      `Squad building is never simple, but this move could make a difference.`,
    ]);
  }

  if (
    text.includes('win') ||
    text.includes('victory') ||
    text.includes('three points')
  ) {
    return getRandomItem([
      `What a result. The team looked much more confident today.`,
      `Three points that could be very important later in the season.`,
      `Good performance. The manager deserves credit for this one.`,
      `The supporters will definitely enjoy this result.`,
    ]);
  }

  if (
    text.includes('loss') ||
    text.includes('lose') ||
    text.includes('defeat')
  ) {
    return getRandomItem([
      `Tough result, but there is still plenty of football left to play.`,
      `The team needs to react quickly from this setback.`,
      `Not the result they wanted. The next fixture will be important.`,
      `A difficult afternoon. Tactical changes may be needed.`,
    ]);
  }

  if (
    text.includes('injury') ||
    text.includes('injured')
  ) {
    return getRandomItem([
      `Hopefully the player makes a quick recovery.`,
      `Injuries can change a season very quickly. Squad depth will matter.`,
      `Bad news for the team. Medical staff will be important here.`,
    ]);
  }

  return getRandomItem([
    `Interesting update. I will be watching this closely.`,
    `The project is becoming interesting. Let's see what happens next.`,
    `Football is unpredictable. This could go either way.`,
    `There is definitely something to discuss here.`,
    `The supporters will have plenty to say about this.`,
    `Interesting decision from the manager.`,
  ]);
}

/* =========================================================
   AI ENGAGEMENT
========================================================= */

async function simulateAIEngagement({
  postId,
  post,
  clubInfo,
}) {
  if (!postId || !post) {
    return;
  }

  const postRef = doc(
    db,
    'posts',
    postId
  );

  try {
    await runTransaction(db, async (transaction) => {
      const snapshot =
        await transaction.get(postRef);

      if (!snapshot.exists()) {
        return;
      }

      const current =
        snapshot.data();

      const lastAI =
        getTimestampValue(
          current.aiEngagedAt
        );

      const now = Date.now();

      if (
        lastAI &&
        now - lastAI < AI_MIN_LIKE_DELAY
      ) {
        return;
      }

      const currentLikes =
        Array.isArray(current.aiLikes)
          ? current.aiLikes
          : [];

      const aiPool =
        AI_PERSONAS.filter(
          (ai) =>
            !currentLikes.includes(ai.id)
        );

      const numberOfLikes =
        Math.floor(
          Math.random() * 3
        );

      const selectedAI =
        aiPool
          .sort(() => Math.random() - 0.5)
          .slice(0, numberOfLikes);

      const aiLikeIds =
        selectedAI.map(
          (ai) => ai.id
        );

      const updates = {
        aiEngagedAt:
          serverTimestamp(),
      };

      if (aiLikeIds.length > 0) {
        updates.aiLikes =
          arrayUnion(...aiLikeIds);

        updates.likeCount =
          increment(
            aiLikeIds.length
          );
      }

      transaction.update(
        postRef,
        updates
      );
    });

    /*
      AI comments are intentionally limited.
      We do them separately so a single post
      does not suddenly receive a stadium full
      of robots shouting at it.
    */

    const shouldComment =
      Math.random() < 0.35;

    if (!shouldComment) {
      return;
    }

    const commentsRef =
      collection(
        db,
        'posts',
        postId,
        'comments'
      );

    const commentsSnapshot =
      await getDocs(
        query(
          commentsRef,
          limit(MAX_COMMENTS)
        )
      );

    const existingAIComments =
      commentsSnapshot.docs.filter(
        (commentDoc) =>
          commentDoc.data()?.isAI === true
      );

    if (
      existingAIComments.length >= 3
    ) {
      return;
    }

    const ai =
      getRandomItem(
        AI_PERSONAS
      );

    if (!ai) return;

    const comment =
      generateAIComment({
        post,
        clubInfo,
      });

    await addDoc(
      commentsRef,
      {
        userId: ai.id,
        username: ai.name,
        avatar: ai.avatar,
        content: comment,
        isAI: true,
        createdAt:
          serverTimestamp(),
      }
    );
  } catch (error) {
    console.error(
      'AI engagement error:',
      error
    );
  }
}

/* =========================================================
   PAGE
========================================================= */

export default function NewsPage() {
  const router = useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  const [careerData, setCareerData] =
    useState(null);

  const [clubInfo, setClubInfo] =
    useState(null);

  const [matches, setMatches] =
    useState([]);

  const [players, setPlayers] =
    useState([]);

  const [posts, setPosts] =
    useState([]);

  const [comments, setComments] =
    useState({});

  const [isLoading, setIsLoading] =
    useState(true);

  const [activeFilter, setActiveFilter] =
    useState('all');

  const [searchTerm, setSearchTerm] =
    useState('');

  const [postText, setPostText] =
    useState('');

  const [posting, setPosting] =
    useState(false);

  const [commentText, setCommentText] =
    useState({});

  const [openComments, setOpenComments] =
    useState({});

  const [loadingComments, setLoadingComments] =
    useState({});

  const [selectedMedia, setSelectedMedia] =
    useState(null);

  const [mediaInterview, setMediaInterview] =
    useState(null);

  const aiTimers =
    useRef({});

  const lastPostTime =
    useRef(0);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      router.push('/login');
    }
  }, [
    loading,
    user,
    router,
  ]);

  /* =======================================================
     LOAD USER / CLUB / PLAYERS / MATCHES
  ======================================================= */

  const fetchBaseData =
    useCallback(async () => {
      if (!user) {
        return;
      }

      try {
        setIsLoading(true);

        const userRef =
          doc(
            db,
            'users',
            user.uid
          );

        const userSnapshot =
          await getDoc(userRef);

        if (!userSnapshot.exists()) {
          toast.error(
            'User account not found'
          );

          return;
        }

        const data =
          userSnapshot.data();

        const career =
          data.careerData || {};

        setCareerData(career);

        if (!career.currentClub) {
          setMatches([]);
          setPlayers([]);
          setClubInfo(null);
          return;
        }

        const clubRef =
          doc(
            db,
            'clubs',
            career.currentClub
          );

        const clubSnapshot =
          await getDoc(clubRef);

        if (
          clubSnapshot.exists()
        ) {
          setClubInfo({
            id:
              clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }

        /* ---------------------------------------------
           PLAYERS
        --------------------------------------------- */

        const playersQuery =
          query(
            collection(
              db,
              'players'
            ),
            where(
              'clubId',
              '==',
              career.currentClub
            )
          );

        const playersSnapshot =
          await getDocs(
            playersQuery
          );

        const playerList = [];

        playersSnapshot.forEach(
          (playerDoc) => {
            playerList.push({
              id:
                playerDoc.id,
              ...playerDoc.data(),
            });
          }
        );

        setPlayers(
          playerList
        );

        /* ---------------------------------------------
           MATCHES
        --------------------------------------------- */

        const matchesQuery =
          query(
            collection(
              db,
              'matches'
            ),
            where(
              'seasonYear',
              '==',
              getSeasonYear()
            )
          );

        const matchesSnapshot =
          await getDocs(
            matchesQuery
          );

        const matchList = [];

        matchesSnapshot.forEach(
          (matchDoc) => {
            const match =
              matchDoc.data();

            const belongsToClub =
              match.homeClubId ===
                career.currentClub ||
              match.awayClubId ===
                career.currentClub ||
              match.homeTeamId ===
                career.currentClub ||
              match.awayTeamId ===
                career.currentClub;

            if (
              belongsToClub
            ) {
              matchList.push({
                id:
                  matchDoc.id,
                ...match,
              });
            }
          }
        );

        setMatches(
          matchList
        );
      } catch (error) {
        console.error(
          'Fetch news error:',
          error
        );

        toast.error(
          'Failed to load football data'
        );
      } finally {
        setIsLoading(false);
      }
    }, [user]);

  useEffect(() => {
    if (!loading && user) {
      fetchBaseData();
    }
  }, [
    loading,
    user,
    fetchBaseData,
  ]);

  /* =======================================================
     REAL-TIME COMMUNITY POSTS
  ======================================================= */

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const postsRef =
      collection(
        db,
        'posts'
      );

    /*
      We intentionally avoid orderBy here.
      This means Firestore does not require
      an extra composite index just to display
      the community feed.
    */

    const postsQuery =
      query(
        postsRef,
        limit(MAX_POSTS)
      );

    const unsubscribe =
      onSnapshot(
        postsQuery,
        (snapshot) => {
          const list =
            snapshot.docs.map(
              (postDoc) => ({
                id:
                  postDoc.id,
                ...postDoc.data(),
              })
            );

          list.sort(
            (a, b) =>
              getTimestampValue(
                b.createdAt
              ) -
              getTimestampValue(
                a.createdAt
              )
          );

          setPosts(list);
        },
        (error) => {
          console.error(
            'Posts listener error:',
            error
          );
        }
      );

    return () =>
      unsubscribe();
  }, [user]);

  /* =======================================================
     REAL-TIME COMMENTS
  ======================================================= */

  const subscribeComments =
    useCallback(
      (postId) => {
        if (!postId) {
          return () => {};
        }

        const commentsRef =
          collection(
            db,
            'posts',
            postId,
            'comments'
          );

        const commentsQuery =
          query(
            commentsRef,
            limit(MAX_COMMENTS)
          );

        const unsubscribe =
          onSnapshot(
            commentsQuery,
            (snapshot) => {
              const list =
                snapshot.docs.map(
                  (commentDoc) => ({
                    id:
                      commentDoc.id,
                    ...commentDoc.data(),
                  })
                );

              list.sort(
                (a, b) =>
                  getTimestampValue(
                    a.createdAt
                  ) -
                  getTimestampValue(
                    b.createdAt
                  )
              );

              setComments(
                (previous) => ({
                  ...previous,
                  [postId]: list,
                })
              );
            },
            (error) => {
              console.error(
                'Comments listener error:',
                error
              );
            }
          );

        return unsubscribe;
      },
      []
    );

  const toggleComments =
    useCallback(
      (postId) => {
        setOpenComments(
          (previous) => ({
            ...previous,
            [postId]:
              !previous[postId],
          })
        );

        if (
          !openComments[postId]
        ) {
          setLoadingComments(
            (previous) => ({
              ...previous,
              [postId]: true,
            })
          );

          subscribeComments(
            postId
          );

          setTimeout(() => {
            setLoadingComments(
              (previous) => ({
                ...previous,
                [postId]: false,
              })
            );
          }, 500);
        }
      },
      [
        openComments,
        subscribeComments,
      ]
    );

  /* =======================================================
     AI ENGAGEMENT
  ======================================================= */

  useEffect(() => {
    if (
      !user ||
      posts.length === 0 ||
      !clubInfo
    ) {
      return undefined;
    }

    posts
      .filter(
        (post) =>
          !post.isAIOnly
      )
      .slice(0, 15)
      .forEach((post) => {
        if (
          aiTimers.current[
            post.id
          ]
        ) {
          return;
        }

        const delay =
          AI_MIN_LIKE_DELAY +
          Math.random() *
            (
              AI_MAX_LIKE_DELAY -
              AI_MIN_LIKE_DELAY
            );

        aiTimers.current[
          post.id
        ] = setTimeout(
          () => {
            simulateAIEngagement({
              postId:
                post.id,
              post,
              clubInfo,
            });

            delete aiTimers.current[
              post.id
            ];
          },
          delay
        );
      });

    return () => {
      Object.values(
        aiTimers.current
      ).forEach(
        (timer) =>
          clearTimeout(timer)
      );

      aiTimers.current = {};
    };
  }, [
    user,
    posts,
    clubInfo,
  ]);

  /* =======================================================
     GENERATE NEWS
  ======================================================= */

  const generatedNews =
    useMemo(() => {
      if (!clubInfo) {
        return [];
      }

      const clubName =
        clubInfo.name ||
        'Your Club';

      const clubId =
        clubInfo.id;

      const newsItems = [];

      newsItems.push(
        ...generateMatchNews(
          matches,
          clubId,
          clubName
        )
      );

      newsItems.push(
        ...generateTransferNews(
          players,
          clubId,
          clubName
        )
      );

      newsItems.push(
        ...generateInjuryNews(
          players,
          clubName
        )
      );

      newsItems.push(
        ...generateYouthNews(
          players,
          clubName
        )
      );

      newsItems.push(
        ...generateFinanceNews(
          clubInfo,
          careerData
        )
      );

      newsItems.push(
        ...generateLeagueNews(
          clubInfo,
          careerData
        )
      );

      newsItems.push(
        ...generateMediaReports({
          clubInfo,
          careerData,
          players,
          matches,
        })
      );

      if (
        careerData?.boardConfidence !==
        undefined
      ) {
        const confidence =
          safeNumber(
            careerData.boardConfidence,
            70
          );

        newsItems.push({
          id:
            `news-board-${confidence}`,
          type: 'board',
          icon:
            NEWS_TEMPLATES.board.icon,
          title:
            NEWS_TEMPLATES.board.title,
          color:
            NEWS_TEMPLATES.board.color,
          headline:
            `Board confidence is ${confidence}%`,
          body:
            confidence >= 75
              ? 'The board is pleased with the direction of the club.'
              : confidence >= 50
                ? 'The board remains patient but expects improved results.'
                : 'The board is becoming increasingly concerned about the club.',
          date:
            careerData.boardConfidenceUpdatedAt ||
            new Date().toISOString(),
        });
      }

      newsItems.sort(
        (a, b) =>
          getTimestampValue(
            b.date
          ) -
          getTimestampValue(
            a.date
          )
      );

      return newsItems.slice(
        0,
        MAX_NEWS
      );
    }, [
      clubInfo,
      matches,
      players,
      careerData,
    ]);

  /* =======================================================
     COMMUNITY POSTS AS NEWS
  ======================================================= */

  const communityNews =
    useMemo(() => {
      return posts.map(
        (post) => ({
          ...post,
          isCommunityPost:
            true,
          type:
            'community',
          icon: '👥',
          title:
            post.isAI
              ? 'AI Football Community'
              : 'Manager Community',
          color:
            '#06b6d4',
          headline:
            post.title ||
            `${post.username || 'Manager'} posted an update`,
          body:
            post.content || '',
          date:
            post.createdAt ||
            new Date().toISOString(),
        })
      );
    }, [posts]);

  /* =======================================================
     ALL FEED
  ======================================================= */

  const allFeed =
    useMemo(() => {
      return [
        ...generatedNews,
        ...communityNews,
      ].sort(
        (a, b) =>
          getTimestampValue(
            b.date
          ) -
          getTimestampValue(
            a.date
          )
      );
    }, [
      generatedNews,
      communityNews,
    ]);

  /* =======================================================
     FILTERS
  ======================================================= */

  const filterTypes =
    useMemo(() => {
      const available =
        new Set(
          allFeed.map(
            (item) =>
              item.type
          )
        );

      const filters = [
        {
          value: 'all',
          label: 'All',
          icon: '📰',
        },
        {
          value: 'match_result',
          label: 'Matches',
          icon: '⚽',
        },
        {
          value: 'transfer',
          label: 'Transfers',
          icon: '🔄',
        },
        {
          value: 'injury',
          label: 'Injuries',
          icon: '🩹',
        },
        {
          value: 'media',
          label: 'Media',
          icon: '📺',
        },
        {
          value: 'interview',
          label: 'Interviews',
          icon: '🎤',
        },
        {
          value: 'community',
          label: 'Community',
          icon: '👥',
        },
        {
          value: 'finance',
          label: 'Finance',
          icon: '💰',
        },
        {
          value: 'league',
          label: 'League',
          icon: '📊',
        },
      ];

      return filters.filter(
        (filter) =>
          filter.value ===
            'all' ||
          available.has(
            filter.value
          )
      );
    }, [allFeed]);

  const filteredFeed =
    useMemo(() => {
      let result =
        allFeed;

      if (
        activeFilter !==
        'all'
      ) {
        result =
          result.filter(
            (item) =>
              item.type ===
              activeFilter
          );
      }

      if (
        searchTerm.trim()
      ) {
        const search =
          searchTerm
            .trim()
            .toLowerCase();

        result =
          result.filter(
            (item) =>
              safeString(
                item.headline
              )
                .toLowerCase()
                .includes(search) ||
              safeString(
                item.body
              )
                .toLowerCase()
                .includes(search) ||
              safeString(
                item.username
              )
                .toLowerCase()
                .includes(search)
          );
      }

      return result;
    }, [
      allFeed,
      activeFilter,
      searchTerm,
    ]);

  /* =======================================================
     CREATE USER POST
  ======================================================= */

  const createPost =
    async () => {
      if (!user) {
        toast.error(
          'You must be logged in'
        );
        return;
      }

      const content =
        postText.trim();

      if (!content) {
        toast.error(
          'Write something first'
        );
        return;
      }

      if (
        content.length > 1000
      ) {
        toast.error(
          'Post is too long. Maximum 1000 characters.'
        );
        return;
      }

      const now =
        Date.now();

      if (
        now -
          lastPostTime.current <
        POST_COOLDOWN
      ) {
        toast.error(
          'Please wait a few seconds before posting again'
        );
        return;
      }

      try {
        setPosting(true);

        const username =
          userData?.username ||
          userData?.displayName ||
          user.displayName ||
          user.email?.split(
            '@'
          )[0] ||
          'Manager';

        await addDoc(
          collection(
            db,
            'posts'
          ),
          {
            userId:
              user.uid,

            username,

            avatar:
              userData?.photoURL ||
              user.photoURL ||
              '',

            title:
              `${clubInfo?.name || 'Club'} Update`,

            content,

            type:
              'manager_post',

            likeCount:
              0,

            commentCount:
              0,

            likes: [],

            aiLikes: [],

            isAI:
              false,

            isAIOnly:
              false,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp(),

            aiEngagedAt:
              null,
          }
        );

        setPostText('');

        lastPostTime.current =
          Date.now();

        toast.success(
          'Post published'
        );
      } catch (error) {
        console.error(
          'Create post error:',
          error
        );

        toast.error(
          'Could not publish post'
        );
      } finally {
        setPosting(false);
      }
    };

  /* =======================================================
     LIKE / UNLIKE
  ======================================================= */

  const toggleLike =
    async (post) => {
      if (!user) {
        return;
      }

      const postRef =
        doc(
          db,
          'posts',
          post.id
        );

      try {
        await runTransaction(
          db,
          async (
            transaction
          ) => {
            const snapshot =
              await transaction.get(
                postRef
              );

            if (
              !snapshot.exists()
            ) {
              return;
            }

            const data =
              snapshot.data();

            const likes =
              Array.isArray(
                data.likes
              )
                ? data.likes
                : [];

            const alreadyLiked =
              likes.includes(
                user.uid
              );

            transaction.update(
              postRef,
              {
                likes:
                  alreadyLiked
                    ? arrayRemove(
                        user.uid
                      )
                    : arrayUnion(
                        user.uid
                      ),

                likeCount:
                  increment(
                    alreadyLiked
                      ? -1
                      : 1
                  ),

                updatedAt:
                  serverTimestamp(),
              }
            );
          }
        );
      } catch (error) {
        console.error(
          'Like error:',
          error
        );

        toast.error(
          'Could not update like'
        );
      }
    };

  /* =======================================================
     ADD COMMENT
  ======================================================= */

  const addComment =
    async (post) => {
      if (!user) {
        return;
      }

      const text =
        safeString(
          commentText[post.id],
          ''
        ).trim();

      if (!text) {
        return;
      }

      if (
        text.length > 500
      ) {
        toast.error(
          'Comment is too long'
        );
        return;
      }

      try {
        const username =
          userData?.username ||
          userData?.displayName ||
          user.displayName ||
          user.email?.split(
            '@'
          )[0] ||
          'Manager';

        await addDoc(
          collection(
            db,
            'posts',
            post.id,
            'comments'
          ),
          {
            userId:
              user.uid,

            username,

            avatar:
              userData?.photoURL ||
              user.photoURL ||
              '',

            content:
              text,

            isAI:
              false,

            createdAt:
              serverTimestamp(),
          }
        );

        await updateDoc(
          doc(
            db,
            'posts',
            post.id
          ),
          {
            commentCount:
              increment(1),

            updatedAt:
              serverTimestamp(),
          }
        );

        setCommentText(
          (previous) => ({
            ...previous,
            [post.id]:
              '',
          })
        );
      } catch (error) {
        console.error(
          'Comment error:',
          error
        );

        toast.error(
          'Could not add comment'
        );
      }
    };

  /* =======================================================
     MEDIA INTERVIEW
  ======================================================= */

  const openInterview =
    () => {
      const interview =
        generateInterview({
          clubInfo,
          careerData,
          players,
        });

      setMediaInterview(
        interview
      );
    };

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    isLoading
  ) {
    return (
      <div
        className={
          styles.loadingContainer
        }
      >
        <div
          className={
            styles.spinner
          }
        />

        <p>
          Loading football world...
        </p>
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
        <title>
          Football News - Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Live football news, transfers, injuries, media reports and manager community."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <header
          className={
            styles.header
          }
        >
          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              GLOBAL FOOTBALL NETWORK
            </span>

            <h1>
              Football News
            </h1>

            <p>
              Transfers, injuries,
              results, interviews,
              media reports and
              manager discussions.
            </p>
          </div>

          <div
            className={
              styles.headerStats
            }
          >
            <div
              className={
                styles.statBox
              }
            >
              <strong>
                {allFeed.length}
              </strong>

              <span>
                Stories
              </span>
            </div>

            <div
              className={
                styles.statBox
              }
            >
              <strong>
                {posts.length}
              </strong>

              <span>
                Community Posts
              </span>
            </div>
          </div>
        </header>

        {/* =================================================
            MEDIA BAR
        ================================================= */}

        <section
          className={
            styles.mediaBar
          }
        >
          <div
            className={
              styles.mediaBarTitle
            }
          >
            <span>
              📺
            </span>

            <div>
              <strong>
                Football Media
              </strong>

              <small>
                Latest reports from
                around the football
                world
              </small>
            </div>
          </div>

          <div
            className={
              styles.mediaOutlets
            }
          >
            {MEDIA_OUTLETS
              .slice(0, 4)
              .map(
                (outlet) => (
                  <button
                    key={
                      outlet.id
                    }
                    type="button"
                    className={
                      styles.mediaOutlet
                    }
                    style={{
                      '--media-color':
                        outlet.color,
                    }}
                    onClick={() =>
                      setSelectedMedia(
                        outlet
                      )
                    }
                  >
                    <span>
                      {
                        outlet.icon
                      }
                    </span>

                    <div>
                      <strong>
                        {
                          outlet.name
                        }
                      </strong>

                      <small>
                        {
                          outlet.type
                        }
                      </small>
                    </div>
                  </button>
                )
              )}
          </div>

          <button
            type="button"
            className={
              styles.interviewButton
            }
            onClick={
              openInterview
            }
          >
            🎤
            <span>
              Media Interview
            </span>
          </button>
        </section>

        {/* =================================================
            CREATE POST
        ================================================= */}

        <section
          className={
            styles.createPost
          }
        >
          <div
            className={
              styles.createPostHeader
            }
          >
            <div
              className={
                styles.userAvatar
              }
            >
              {(
                userData?.username ||
                user.displayName ||
                'M'
              )
                .charAt(0)
                .toUpperCase()}
            </div>

            <div>
              <strong>
                Share with football world
              </strong>

              <small>
                Post an update,
                opinion or club news.
              </small>
            </div>
          </div>

          <textarea
            className={
              styles.postTextarea
            }
            value={
              postText
            }
            maxLength={1000}
            onChange={(event) =>
              setPostText(
                event.target.value
              )
            }
            placeholder="What's happening at your club?"
          />

          <div
            className={
              styles.createPostFooter
            }
          >
            <span>
              {postText.length}
              /1000
            </span>

            <button
              type="button"
              className={
                styles.publishButton
              }
              disabled={
                posting ||
                !postText.trim()
              }
              onClick={
                createPost
              }
            >
              {posting
                ? 'Publishing...'
                : '🚀 Publish Post'}
            </button>
          </div>
        </section>

        {/* =================================================
            SEARCH
        ================================================= */}

        <section
          className={
            styles.searchSection
          }
        >
          <div
            className={
              styles.searchBox
            }
          >
            <span>
              🔎
            </span>

            <input
              type="text"
              value={
                searchTerm
              }
              onChange={(
                event
              ) =>
                setSearchTerm(
                  event.target.value
                )
              }
              placeholder="Search football news..."
            />
          </div>
        </section>

        {/* =================================================
            FILTERS
        ================================================= */}

        <nav
          className={
            styles.filters
          }
        >
          {filterTypes.map(
            (filter) => (
              <button
                key={
                  filter.value
                }
                type="button"
                className={
                  activeFilter ===
                  filter.value
                    ? styles.activeFilter
                    : ''
                }
                onClick={() =>
                  setActiveFilter(
                    filter.value
                  )
                }
              >
                <span>
                  {
                    filter.icon
                  }
                </span>

                {
                  filter.label
                }
              </button>
            )
          )}
        </nav>

        {/* =================================================
            FEED
        ================================================= */}

        <section
          className={
            styles.newsList
          }
        >
          {filteredFeed.length >
          0 ? (
            filteredFeed.map(
              (item) => {
                /* =========================================
                   COMMUNITY POST
                ========================================= */

                if (
                  item.isCommunityPost
                ) {
                  const post =
                    posts.find(
                      (p) =>
                        p.id ===
                        item.id
                    ) ||
                    item;

                  const likes =
                    Array.isArray(
                      post.likes
                    )
                      ? post.likes
                      : [];

                  const aiLikes =
                    Array.isArray(
                      post.aiLikes
                    )
                      ? post.aiLikes
                      : [];

                  const liked =
                    user &&
                    likes.includes(
                      user.uid
                    );

                  const postComments =
                    comments[
                      post.id
                    ] || [];

                  return (
                    <article
                      key={
                        item.id
                      }
                      className={
                        styles.communityPost
                      }
                    >
                      <div
                        className={
                          styles.postHeader
                        }
                      >
                        <div
                          className={
                            styles.postAvatar
                          }
                        >
                          {post.avatar ? (
                            <img
                              src={
                                post.avatar
                              }
                              alt={
                                post.username ||
                                'Manager'
                              }
                            />
                          ) : (
                            safeString(
                              post.username,
                              'M'
                            )
                              .charAt(
                                0
                              )
                              .toUpperCase()
                          )}
                        </div>

                        <div
                          className={
                            styles.postAuthor
                          }
                        >
                          <strong>
                            {
                              post.username ||
                              'Manager'
                            }
                          </strong>

                          <small>
                            Manager
                            Community
                            •{' '}
                            {timeAgo(
                              post.createdAt
                            )}
                          </small>
                        </div>

                        {post.isAI && (
                          <span
                            className={
                              styles.aiBadge
                            }
                          >
                            🤖 AI
                          </span>
                        )}
                      </div>

                      <div
                        className={
                          styles.postBody
                        }
                      >
                        {post.title && (
                          <h2>
                            {
                              post.title
                            }
                          </h2>
                        )}

                        <p>
                          {
                            post.content
                          }
                        </p>
                      </div>

                      <div
                        className={
                          styles.postStats
                        }
                      >
                        <span>
                          ❤️{' '}
                          {
                            safeNumber(
                              post.likeCount
                            )
                          }
                        </span>

                        <span>
                          🤖{' '}
                          {
                            aiLikes.length
                          } AI
                        </span>

                        <span>
                          💬{' '}
                          {
                            safeNumber(
                              post.commentCount
                            )
                          }
                        </span>
                      </div>

                      <div
                        className={
                          styles.postActions
                        }
                      >
                        <button
                          type="button"
                          className={
                            liked
                              ? styles.likedButton
                              : ''
                          }
                          onClick={() =>
                            toggleLike(
                              post
                            )
                          }
                        >
                          {liked
                            ? '❤️ Liked'
                            : '🤍 Like'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            toggleComments(
                              post.id
                            )
                          }
                        >
                          💬 Comments
                        </button>
                      </div>

                      {openComments[
                        post.id
                      ] && (
                        <div
                          className={
                            styles.commentsArea
                          }
                        >
                          <div
                            className={
                              styles.commentInput
                            }
                          >
                            <input
                              type="text"
                              value={
                                commentText[
                                  post.id
                                ] || ''
                              }
                              onChange={(
                                event
                              ) =>
                                setCommentText(
                                  (
                                    previous
                                  ) => ({
                                    ...previous,
                                    [post.id]:
                                      event
                                        .target
                                        .value,
                                  })
                                )
                              }
                              onKeyDown={(
                                event
                              ) => {
                                if (
                                  event.key ===
                                  'Enter'
                                ) {
                                  addComment(
                                    post
                                  );
                                }
                              }}
                              placeholder="Write a comment..."
                            />

                            <button
                              type="button"
                              onClick={() =>
                                addComment(
                                  post
                                )
                              }
                            >
                              Send
                            </button>
                          </div>

                          {loadingComments[
                            post.id
                          ] ? (
                            <div
                              className={
                                styles.commentLoading
                              }
                            >
                              Loading
                              comments...
                            </div>
                          ) : postComments.length >
                            0 ? (
                            <div
                              className={
                                styles.commentsList
                              }
                            >
                              {postComments.map(
                                (
                                  comment
                                ) => (
                                  <div
                                    key={
                                      comment.id
                                    }
                                    className={
                                      styles.comment
                                    }
                                  >
                                    <div
                                      className={
                                        styles.commentAvatar
                                      }
                                    >
                                      {
                                        comment.avatar ||
                                        safeString(
                                          comment.username,
                                          'U'
                                        )
                                          .charAt(
                                            0
                                          )
                                          .toUpperCase()
                                      }
                                    </div>

                                    <div
                                      className={
                                        styles.commentContent
                                      }
                                    >
                                      <div
                                        className={
                                          styles.commentTop
                                        }
                                      >
                                        <strong>
                                          {
                                            comment.username
                                          }
                                        </strong>

                                        {comment.isAI && (
                                          <span
                                            className={
                                              styles.aiCommentBadge
                                            }
                                          >
                                            🤖 AI
                                          </span>
                                        )}
                                      </div>

                                      <p>
                                        {
                                          comment.content
                                        }
                                      </p>

                                      <small>
                                        {
                                          timeAgo(
                                            comment.createdAt
                                          )
                                        }
                                      </small>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          ) : (
                            <div
                              className={
                                styles.emptyComments
                              }
                            >
                              No comments
                              yet.
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                }

                /* =========================================
                   NORMAL NEWS CARD
                ========================================= */

                return (
                  <article
                    key={
                      item.id
                    }
                    className={
                      styles.newsCard
                    }
                    style={{
                      borderLeftColor:
                        item.color,
                    }}
                  >
                    <div
                      className={
                        styles.newsIcon
                      }
                      style={{
                        background:
                          `${item.color}18`,
                      }}
                    >
                      <span>
                        {
                          item.icon
                        }
                      </span>
                    </div>

                    <div
                      className={
                        styles.newsContent
                      }
                    >
                      <div
                        className={
                          styles.newsHeader
                        }
                      >
                        <span
                          className={
                            styles.newsType
                          }
                          style={{
                            color:
                              item.color,
                          }}
                        >
                          {
                            item.title
                          }
                        </span>

                        <span
                          className={
                            styles.newsTime
                          }
                        >
                          {timeAgo(
                            item.date
                          )}
                        </span>
                      </div>

                      <h2
                        className={
                          styles.newsHeadline
                        }
                      >
                        {
                          item.headline
                        }
                      </h2>

                      <p
                        className={
                          styles.newsBody
                        }
                      >
                        {
                          item.body
                        }
                      </p>

                      {item.type ===
                        'media' && (
                        <button
                          type="button"
                          className={
                            styles.readReportButton
                          }
                          onClick={() =>
                            setSelectedMedia(
                              MEDIA_OUTLETS.find(
                                (
                                  outlet
                                ) =>
                                  outlet.id ===
                                  item.mediaOutletId
                              ) ||
                                MEDIA_OUTLETS[0]
                            )
                          }
                        >
                          📺 Read
                          full media
                          report
                        </button>
                      )}

                      <div
                        className={
                          styles.newsFooter
                        }
                      >
                        <span>
                          {
                            formatDate(
                              item.date
                            )
                          }
                        </span>

                        <span>
                          {
                            formatTime(
                              item.date
                            )
                          }
                        </span>
                      </div>
                    </div>
                  </article>
                );
              }
            )
          ) : (
            <div
              className={
                styles.emptyState
              }
            >
              <span>
                📰
              </span>

              <h3>
                No news found
              </h3>

              <p>
                There are no stories
                matching your current
                filters.
              </p>
            </div>
          )}
        </section>

        {/* =================================================
            MEDIA MODAL
        ================================================= */}

        {selectedMedia && (
          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setSelectedMedia(
                null
              )
            }
          >
            <div
              className={
                styles.modal
              }
              onClick={(event) =>
                event.stopPropagation()
              }
            >
              <div
                className={
                  styles.modalHeader
                }
              >
                <div>
                  <span
                    className={
                      styles.modalIcon
                    }
                  >
                    {
                      selectedMedia.icon
                    }
                  </span>

                  <div>
                    <strong>
                      {
                        selectedMedia.name
                      }
                    </strong>

                    <small>
                      {
                        selectedMedia.type
                      }
                    </small>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedMedia(
                      null
                    )
                  }
                >
                  ×
                </button>
              </div>

              <div
                className={
                  styles.modalBody
                }
              >
                <span
                  className={
                    styles.liveLabel
                  }
                >
                  ● LIVE MEDIA
                </span>

                <h2>
                  {
                    selectedMedia.name
                  } is following
                  the story
                </h2>

                <p>
                  Our journalists are
                  monitoring developments
                  around{' '}
                  <strong>
                    {
                      clubInfo?.name ||
                      'your club'
                    }
                  </strong>
                  .
                </p>

                <p>
                  Transfer activity,
                  tactical decisions,
                  player performances
                  and manager decisions
                  will continue to be
                  analysed throughout
                  the season.
                </p>

                <div
                  className={
                    styles.mediaQuote
                  }
                >
                  “The story is still
                  developing. Our
                  reporters will continue
                  following every major
                  development.”
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================
            INTERVIEW MODAL
        ================================================= */}

        {mediaInterview && (
          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setMediaInterview(
                null
              )
            }
          >
            <div
              className={
                styles.interviewModal
              }
              onClick={(event) =>
                event.stopPropagation()
              }
            >
              <div
                className={
                  styles.interviewHero
                }
              >
                <span>
                  🎤
                </span>

                <div>
                  <small>
                    EXCLUSIVE
                  </small>

                  <h2>
                    {
                      mediaInterview.title
                    }
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setMediaInterview(
                      null
                    )
                  }
                >
                  ×
                </button>
              </div>

              <div
                className={
                  styles.interviewBody
                }
              >
                <h3>
                  {
                    mediaInterview.headline
                  }
                </h3>

                <p>
                  {
                    mediaInterview.body
                  }
                </p>

                <span
                  className={
                    styles.interviewDisclaimer
                  }
                >
                  🎙️ Simulated media
                  interview from the
                  football world.
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
