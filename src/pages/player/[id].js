// pages/player/[id].js

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '../../components/firebase';
import { useAuth } from '../../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './player.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const SYSTEM_RESPONSE_DAYS = 2;
const MIN_OFFER_RATIO = 0.50;
const MAX_OFFER_RATIO = 2.00;

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(safeNumber(value));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function playerName(player) {
  if (!player) return 'Unknown Player';
  return (
    player.name ||
    player.fullName ||
    [player.firstName, player.lastName].filter(Boolean).join(' ') ||
    'Unknown Player'
  );
}

function playerPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    'Unknown'
  );
}

function playerOverall(player) {
  return safeNumber(
    player?.overall ?? player?.rating ?? player?.overallRating,
    0
  );
}

function playerValue(player) {
  return safeNumber(
    player?.marketValue ?? player?.value ?? player?.askingPrice,
    0
  );
}

function askingPrice(player) {
  return safeNumber(
    player?.askingPrice ?? player?.transferFee ?? playerValue(player),
    0
  );
}

function getClubId(player) {
  return (
    player?.clubId ||
    player?.currentClub ||
    player?.teamId ||
    null
  );
}

function getClubName(player) {
  return (
    player?.clubName ||
    player?.currentClubName ||
    player?.teamName ||
    'Free Agent'
  );
}

function dateValue(value) {
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

function formatDate(value) {
  const date = dateValue(value);
  if (!date) return 'Not set';
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  const date = dateValue(value);
  if (!date) return 'Not set';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function addGameDays(gameDate, days) {
  const base = dateValue(gameDate);
  if (!base) return null;
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result.toISOString();
}

function daysBetweenGameDates(fromDate, toDate) {
  const from = dateValue(fromDate);
  const to = dateValue(toDate);
  if (!from || !to) return 0;
  return Math.ceil(
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function offerStatus(offer) {
  return normalize(offer?.status || 'pending');
}

function statusText(status) {
  switch (normalize(status)) {
    case 'accepted':
      return 'Accepted';
    case 'rejected':
      return 'Rejected';
    case 'pending':
      return 'Pending';
    case 'negotiation':
      return 'Negotiation';
    case 'joining':
      return 'Joining Club';
    case 'completed':
      return 'Completed';
    default:
      return status || 'Pending';
  }
}

function statusClass(status) {
  const value = normalize(status);
  if (value === 'accepted' || value === 'completed') {
    return styles.success;
  }
  if (value === 'rejected') {
    return styles.danger;
  }
  if (
    value === 'negotiation' ||
    value === 'pending' ||
    value === 'joining'
  ) {
    return styles.warning;
  }
  return styles.pending;
}

function calculateCounterOffer(player, offerAmount, currentAsking) {
  const overall = playerOverall(player);
  let asking = safeNumber(currentAsking, playerValue(player));
  if (asking <= 0) {
    asking = playerValue(player);
  }

  let multiplier = 0.90;
  if (overall >= 85) {
    multiplier = 0.98;
  } else if (overall >= 80) {
    multiplier = 0.95;
  } else if (overall >= 75) {
    multiplier = 0.93;
  } else if (overall >= 65) {
    multiplier = 0.90;
  } else {
    multiplier = 0.85;
  }

  let counter = Math.round(asking * multiplier);
  counter = Math.max(counter, Math.round(offerAmount * 1.08));
  return counter;
}

/* =========================================================
   PAGE
========================================================= */

export default function PlayerPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { id: playerId } = router.query;

  const [player, setPlayer] = useState(null);
  const [clubs, setClubs] = useState([]);
  const [careerData, setCareerData] = useState(null);
  const [currentClub, setCurrentClub] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [negotiating, setNegotiating] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [gameDate, setGameDate] = useState(null);

  /* =======================================================
     LOAD PLAYER
  ======================================================= */

  const loadPlayer = useCallback(async () => {
    if (!playerId) return;
    try {
      setIsLoading(true);
      const playerRef = doc(db, 'players', playerId);
      const playerSnapshot = await getDoc(playerRef);
      if (!playerSnapshot.exists()) {
        toast.error('Player not found');
        router.push('/players');
        return;
      }
      setPlayer({
        id: playerSnapshot.id,
        ...playerSnapshot.data(),
      });
    } catch (error) {
      console.error('Player loading error:', error);
      toast.error('Could not load player');
    } finally {
      setIsLoading(false);
    }
  }, [playerId, router]);

  /* =======================================================
     LOAD USER CAREER
  ======================================================= */

  const loadCareer = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const snapshot = await getDoc(userRef);
      if (!snapshot.exists()) {
        setCareerData({});
        return;
      }
      const data = snapshot.data();
      const career = data.careerData || {};
      setCareerData(career);
      setGameDate(career.currentDate || null);

      if (career.currentClub) {
        const clubRef = doc(db, 'clubs', career.currentClub);
        const clubSnapshot = await getDoc(clubRef);
        if (clubSnapshot.exists()) {
          setCurrentClub({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }
      }
    } catch (error) {
      console.error('Career loading error:', error);
    }
  }, [user]);

  /* =======================================================
     LOAD CLUBS
  ======================================================= */

  const loadClubs = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, 'clubs'));
      const list = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
      setClubs(list);
    } catch (error) {
      console.error('Clubs loading error:', error);
    }
  }, []);

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }
    if (user && playerId) {
      loadPlayer();
      loadCareer();
      loadClubs();
    }
  }, [user, loading, playerId, router, loadPlayer, loadCareer, loadClubs]);

  /* =======================================================
     REAL-TIME PLAYER
  ======================================================= */

  useEffect(() => {
    if (!playerId) return;
    const playerRef = doc(db, 'players', playerId);
    const unsubscribe = onSnapshot(
      playerRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setPlayer(null);
          return;
        }
        setPlayer({
          id: snapshot.id,
          ...snapshot.data(),
        });
      },
      (error) => {
        console.error('Player realtime error:', error);
      }
    );
    return () => unsubscribe();
  }, [playerId]);

  /* =======================================================
     REAL-TIME CURRENT CLUB (BUDGET SOURCE)
  ======================================================= */

  useEffect(() => {
    const clubId = careerData?.currentClub;
    if (!clubId) {
      setCurrentClub(null);
      return undefined;
    }

    const clubRef = doc(db, 'clubs', clubId);
    const unsubscribe = onSnapshot(
      clubRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setCurrentClub(null);
          return;
        }
        setCurrentClub({
          id: snapshot.id,
          ...snapshot.data(),
        });
      },
      (error) => {
        console.error('Club realtime error:', error);
      }
    );
    return () => unsubscribe();
  }, [careerData?.currentClub]);

  /* =======================================================
     CLUB INFO
  ======================================================= */

  const playerClub = useMemo(() => {
    if (!player) return null;
    const id = getClubId(player);
    if (!id) return null;
    return clubs.find((club) => club.id === id) || null;
  }, [player, clubs]);

  const sellerIsAI = useMemo(() => {
    if (!playerClub) return true;
    return !playerClub.managerId;
  }, [playerClub]);

  const isOwnPlayer =
    getClubId(player) === careerData?.currentClub;

  /* =======================================================
     TRANSFER OFFERS
  ======================================================= */

  const transferOffers = useMemo(() => {
    if (!player) return [];
    const offers = Array.isArray(player.transferOffers)
      ? player.transferOffers
      : [];
    return [...offers].sort((a, b) => {
      const aDate = dateValue(a.createdAt)?.getTime() || 0;
      const bDate = dateValue(b.createdAt)?.getTime() || 0;
      return bDate - aDate;
    });
  }, [player]);

  /* =======================================================
     USER'S EXISTING OFFER
  ======================================================= */

  const myOffers = useMemo(() => {
    if (!careerData?.currentClub) return [];
    return transferOffers.filter(
      (offer) => offer.buyerClubId === careerData.currentClub
    );
  }, [transferOffers, careerData]);

  const latestMyOffer = myOffers[0] || null;

  const aiCounterOffer = useMemo(() => {
    if (!latestMyOffer) return null;
    const counter = safeNumber(latestMyOffer.counterOffer, 0);
    return counter > 0 ? counter : null;
  }, [latestMyOffer]);

  /* =======================================================
     TRANSFER STATUS
  ======================================================= */

  const transferStatus = normalize(player?.transferStatus);
  const isTransferListed =
    transferStatus.includes('listed') ||
    transferStatus.includes('available') ||
    transferStatus.includes('transfer');

  /* =======================================================
     PLAYER STATS
  ======================================================= */

  const stats = useMemo(
    () => [
      { label: 'Overall', value: playerOverall(player) },
      { label: 'Age', value: safeNumber(player?.age, 0) },
      { label: 'Pace', value: safeNumber(player?.pace ?? player?.speed, 0) },
      { label: 'Shooting', value: safeNumber(player?.shooting ?? player?.finishing, 0) },
      { label: 'Passing', value: safeNumber(player?.passing, 0) },
      { label: 'Dribbling', value: safeNumber(player?.dribbling, 0) },
      { label: 'Defending', value: safeNumber(player?.defending, 0) },
      { label: 'Physical', value: safeNumber(player?.physical, 0) },
      { label: 'Goalkeeping', value: safeNumber(player?.goalkeeping ?? player?.goalkeeper, 0) },
    ],
    [player]
  );

  /* =======================================================
     TRANSFER BUDGET - sourced ONLY from clubs/{clubId}
  ======================================================= */

  const transferBudget = useMemo(() => {
    return safeNumber(currentClub?.transferBudget, 0);
  }, [currentClub]);

  /* =======================================================
     OPEN NEGOTIATION
  ======================================================= */

  function openNegotiation() {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!careerData?.currentClub) {
      toast.error('You do not manage a club.');
      return;
    }
    if (isOwnPlayer) {
      toast.error('This player is already in your club.');
      return;
    }

    if (transferBudget <= 0) {
      toast.error('Your transfer budget is empty.');
      return;
    }

    if (aiCounterOffer) {
      setOfferAmount(String(aiCounterOffer));
    } else {
      setOfferAmount(String(Math.round(askingPrice(player) * 0.85)));
    }
    setShowNegotiation(true);
  }

  /* =======================================================
     SUBMIT NEGOTIATION - uses game date and club budget
  ======================================================= */

  async function submitNegotiation() {
    if (!player || !currentClub || !careerData?.currentClub) return;

    const amount = safeNumber(offerAmount, 0);
    const asking = askingPrice(player);

    if (amount <= 0) {
      toast.error('Enter a valid transfer offer.');
      return;
    }

    if (amount > transferBudget) {
      toast.error(`Your transfer budget is only €${money(transferBudget)}.`);
      return;
    }

    if (asking > 0 && amount < Math.round(asking * MIN_OFFER_RATIO)) {
      toast.error(
        `The offer is too low. Try at least €${money(Math.round(asking * MIN_OFFER_RATIO))}.`
      );
      return;
    }

    if (asking > 0 && amount > Math.round(asking * MAX_OFFER_RATIO)) {
      toast.error(`The offer is unusually high compared with the asking price.`);
      return;
    }

    try {
      setNegotiating(true);

      const offerId = `${careerData.currentClub}-${player.id}-${Date.now()}`;
      const currentGameDate = dateValue(careerData.currentDate) || new Date();
      const responseDeadline = addGameDays(currentGameDate, SYSTEM_RESPONSE_DAYS);

      const offer = {
        id: offerId,
        buyerClubId: careerData.currentClub,
        buyerClubName: currentClub.name || currentClub.clubName || 'My Club',
        playerId: player.id,
        playerName: playerName(player),
        offerAmount: amount,
        askingPrice: asking,
        type: 'transfer',
        status: 'pending',
        createdBy: user.uid,
        createdAt: currentGameDate.toISOString(), // GAME DATE
        gameDate: currentGameDate.toISOString(),
        responseDeadline,
        gameCalendarBased: true,
        sellerClubId: getClubId(player),
        sellerClubName: getClubName(player),
        sellerIsAI,
        negotiationRound: latestMyOffer
          ? safeNumber(latestMyOffer.negotiationRound, 1) + 1
          : 1,
      };

      await updateDoc(doc(db, 'players', player.id), {
        transferOffers: arrayUnion(offer),
        latestOffer: offer,
        transferStatus: 'transfer-negotiation',
        updatedAt: serverTimestamp(),
      });

      setShowNegotiation(false);
      setOfferAmount('');
      toast.success(
        `Offer of €${money(amount)} sent to ${getClubName(player)}.`
      );
    } catch (error) {
      console.error('Negotiation error:', error);
      toast.error('Could not submit transfer offer.');
    } finally {
      setNegotiating(false);
    }
  }

  /* =======================================================
     ACCEPT AI COUNTER - uses game date and club budget
  ======================================================= */

  async function acceptCounterOffer() {
    if (!latestMyOffer || !aiCounterOffer || !player) return;

    if (aiCounterOffer > transferBudget) {
      toast.error('You cannot afford this counter offer.');
      return;
    }

    try {
      setNegotiating(true);

      const offers = Array.isArray(player.transferOffers)
        ? player.transferOffers
        : [];
      const index = offers.findIndex((offer) => offer.id === latestMyOffer.id);

      if (index === -1) {
        toast.error('This negotiation is no longer available.');
        return;
      }

      const updatedOffers = [...offers];
      const currentGameDate = dateValue(careerData?.currentDate) || new Date();

      updatedOffers[index] = {
        ...updatedOffers[index],
        status: 'accepted',
        offerAmount: aiCounterOffer,
        acceptedAt: currentGameDate.toISOString(), // GAME DATE
        acceptedGameDate: currentGameDate.toISOString(),
        gameCalendarBased: true,
        responseNote: `Transfer fee agreed at €${money(aiCounterOffer)}.`,
      };

      await updateDoc(doc(db, 'players', player.id), {
        transferOffers: updatedOffers,
        latestOffer: updatedOffers[index],
        transferStatus: 'accepted',
        pendingTransfer: {
          ...updatedOffers[index],
          fromClubId: getClubId(player),
          fromClubName: getClubName(player),
          toClubId: careerData.currentClub,
          toClubName: currentClub?.name || '',
          joiningDate: addGameDays(currentGameDate, 1),
          status: 'joining',
          gameCalendarBased: true,
        },
        updatedAt: serverTimestamp(),
      });

      toast.success(
        `${playerName(player)} transfer agreed for €${money(aiCounterOffer)}.`
      );
    } catch (error) {
      console.error('Counter acceptance error:', error);
      toast.error('Could not accept counter offer.');
    } finally {
      setNegotiating(false);
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading player...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!player) {
    return (
      <main className={styles.emptyPage}>
        <h1>Player Not Found</h1>
        <button type="button" onClick={() => router.push('/players')}>
          Back to Players
        </button>
      </main>
    );
  }

  const playerValueAmount = playerValue(player);
  const askingPriceAmount = askingPrice(player);

  return (
    <>
      <Head>
        <title>{playerName(player)} | Player</title>
        <meta
          name="description"
          content={`Player profile for ${playerName(player)}`}
        />
      </Head>

      <main className={styles.page}>
        {/* TOP BAR */}
        <header className={styles.header}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => router.back()}
          >
            ← Back
          </button>
          <span className={styles.gameDate}>
            GAME DATE: {formatDate(gameDate)}
          </span>
        </header>

        {/* PLAYER HERO */}
        <section className={styles.hero}>
          <div className={styles.playerPhoto}>
            {player.photo ? (
              <img src={player.photo} alt={playerName(player)} />
            ) : (
              playerName(player).charAt(0).toUpperCase()
            )}
          </div>

          <div className={styles.playerIdentity}>
            <span className={styles.position}>{playerPosition(player)}</span>
            <h1>{playerName(player)}</h1>
            <p>{getClubName(player)}</p>

            <div className={styles.badges}>
              <span>OVR {playerOverall(player)}</span>
              {isTransferListed && (
                <span className={styles.transferBadge}>Transfer Listed</span>
              )}
              {sellerIsAI && (
                <span className={styles.aiBadge}>🤖 AI Club</span>
              )}
            </div>
          </div>

          <div className={styles.heroOverall}>
            <span>OVR</span>
            <strong>{playerOverall(player)}</strong>
          </div>
        </section>

        {/* FINANCIAL INFORMATION */}
        <section className={styles.financeGrid}>
          <article className={styles.infoCard}>
            <span>MARKET VALUE</span>
            <strong>€{money(playerValueAmount)}</strong>
          </article>
          <article className={styles.infoCard}>
            <span>ASKING PRICE</span>
            <strong>€{money(askingPriceAmount)}</strong>
          </article>
          <article className={styles.infoCard}>
            <span>WEEKLY WAGE</span>
            <strong>€{money(player.wage || player.salary || 0)}</strong>
          </article>
          <article className={styles.infoCard}>
            <span>AGE</span>
            <strong>{safeNumber(player.age, 0)}</strong>
          </article>
        </section>

        {/* TRANSFER NEGOTIATION */}
        {!isOwnPlayer && careerData?.currentClub && (
          <section className={styles.negotiationCard}>
            <div>
              <span className={styles.sectionEyebrow}>
                TRANSFER NEGOTIATION
              </span>
              <h2>Sign {playerName(player)}</h2>
              <p>
                {sellerIsAI
                  ? 'This club is controlled by AI. You can negotiate the transfer fee.'
                  : 'This club is managed by another user. Your offer will be sent to the club manager.'}
              </p>

              <div className={styles.negotiationNumbers}>
                <div>
                  <span>Your Budget</span>
                  <strong>€{money(transferBudget)}</strong>
                </div>
                <div>
                  <span>Asking Price</span>
                  <strong>€{money(askingPriceAmount)}</strong>
                </div>
              </div>

              {aiCounterOffer && (
                <div className={styles.counterBox}>
                  <span>🤖 AI CLUB COUNTER OFFER</span>
                  <strong>€{money(aiCounterOffer)}</strong>
                  <p>The AI club has responded with a new transfer fee.</p>
                  <div className={styles.counterActions}>
                    <button
                      type="button"
                      className={styles.acceptCounter}
                      disabled={negotiating}
                      onClick={acceptCounterOffer}
                    >
                      {negotiating
                        ? 'Processing...'
                        : `Accept €${money(aiCounterOffer)}`}
                    </button>
                    <button
                      type="button"
                      className={styles.negotiateAgain}
                      disabled={negotiating}
                      onClick={openNegotiation}
                    >
                      Negotiate Again
                    </button>
                  </div>
                </div>
              )}

              {!aiCounterOffer && (
                <button
                  type="button"
                  className={styles.negotiateButton}
                  onClick={openNegotiation}
                >
                  💼 Negotiate Transfer
                </button>
              )}
            </div>
          </section>
        )}

        {/* CURRENT OFFER */}
        {latestMyOffer && (
          <section className={styles.currentOffer}>
            <div>
              <span>YOUR LATEST OFFER</span>
              <strong>€{money(latestMyOffer.offerAmount)}</strong>
            </div>
            <div>
              <span>STATUS</span>
              <strong className={statusClass(latestMyOffer.status)}>
                {statusText(latestMyOffer.status)}
              </strong>
            </div>
            <div>
              <span>GAME DATE</span>
              <strong>
                {formatDate(latestMyOffer.gameDate || latestMyOffer.createdAt)}
              </strong>
            </div>
            {latestMyOffer.responseDeadline && (
              <div>
                <span>RESPONSE DEADLINE</span>
                <strong>{formatDate(latestMyOffer.responseDeadline)}</strong>
              </div>
            )}
          </section>
        )}

        {/* PLAYER INFORMATION */}
        <section className={styles.contentGrid}>
          <article className={styles.contentCard}>
            <div className={styles.sectionHeader}>
              <span>PLAYER INFORMATION</span>
              <h2>Personal Details</h2>
            </div>
            <div className={styles.detailsGrid}>
              <div>
                <span>Full Name</span>
                <strong>{playerName(player)}</strong>
              </div>
              <div>
                <span>Position</span>
                <strong>{playerPosition(player)}</strong>
              </div>
              <div>
                <span>Club</span>
                <strong>{getClubName(player)}</strong>
              </div>
              <div>
                <span>Age</span>
                <strong>{player.age || 'N/A'}</strong>
              </div>
              <div>
                <span>Nationality</span>
                <strong>{player.nationality || player.country || 'N/A'}</strong>
              </div>
              <div>
                <span>Preferred Foot</span>
                <strong>{player.preferredFoot || player.foot || 'N/A'}</strong>
              </div>
              <div>
                <span>Height</span>
                <strong>{player.height ? `${player.height} cm` : 'N/A'}</strong>
              </div>
              <div>
                <span>Squad Number</span>
                <strong>{player.number || player.shirtNumber || 'N/A'}</strong>
              </div>
            </div>
          </article>

          <article className={styles.contentCard}>
            <div className={styles.sectionHeader}>
              <span>PERFORMANCE</span>
              <h2>Player Attributes</h2>
            </div>
            <div className={styles.statsGrid}>
              {stats.map((stat) => (
                <div key={stat.label} className={styles.statRow}>
                  <span>{stat.label}</span>
                  <div className={styles.statValue}>
                    <div className={styles.statBar}>
                      <div
                        className={styles.statFill}
                        style={{
                          width: `${Math.min(100, Math.max(0, stat.value))}%`,
                        }}
                      />
                    </div>
                    <strong>{stat.value || 0}</strong>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        {/* TRANSFER HISTORY */}
        <section className={styles.historyCard}>
          <div className={styles.sectionHeader}>
            <span>TRANSFER MARKET</span>
            <h2>Negotiation History</h2>
          </div>

          {transferOffers.length === 0 ? (
            <div className={styles.emptyHistory}>
              <span>📭</span>
              <p>No transfer offers have been made for this player yet.</p>
            </div>
          ) : (
            <div className={styles.historyList}>
              {transferOffers.map((offer, index) => {
                const isMine = offer.buyerClubId === careerData?.currentClub;
                return (
                  <article
                    key={offer.id || `${offer.playerId}-${index}`}
                    className={styles.historyItem}
                  >
                    <div>
                      <strong>{offer.buyerClubName || 'Unknown Club'}</strong>
                      <span>offered €{money(offer.offerAmount)}</span>
                    </div>
                    <div>
                      <span>
                        {offer.gameDate
                          ? `Game date: ${formatDate(offer.gameDate)}`
                          : `Submitted: ${formatDate(offer.createdAt)}`}
                      </span>
                      {offer.counterOffer && (
                        <small>AI Counter: €{money(offer.counterOffer)}</small>
                      )}
                    </div>
                    <div>
                      <span className={`${styles.historyStatus} ${statusClass(offer.status)}`}>
                        {statusText(offer.status)}
                      </span>
                      {isMine && <small>Your Offer</small>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* NEGOTIATION MODAL */}
        {showNegotiation && (
          <div
            className={styles.modalOverlay}
            onClick={() => setShowNegotiation(false)}
          >
            <div
              className={styles.modal}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowNegotiation(false)}
              >
                ×
              </button>

              <span className={styles.sectionEyebrow}>
                TRANSFER NEGOTIATION
              </span>
              <h2>{playerName(player)}</h2>
              <p>
                {sellerIsAI
                  ? 'The AI club will evaluate your offer based on the player value, asking price and overall rating.'
                  : 'Your offer will be sent to the manager of the selling club.'}
              </p>

              {aiCounterOffer && (
                <div className={styles.modalCounter}>
                  <span>AI COUNTER OFFER</span>
                  <strong>€{money(aiCounterOffer)}</strong>
                </div>
              )}

              <div className={styles.moneyField}>
                <label>Your Transfer Offer</label>
                <div>
                  <span>€</span>
                  <input
                    type="number"
                    min="0"
                    value={offerAmount}
                    onChange={(event) => setOfferAmount(event.target.value)}
                    placeholder="Enter amount"
                  />
                </div>
              </div>

              <div className={styles.offerInfo}>
                <div>
                  <span>Market Value</span>
                  <strong>€{money(playerValueAmount)}</strong>
                </div>
                <div>
                  <span>Asking Price</span>
                  <strong>€{money(askingPriceAmount)}</strong>
                </div>
                <div>
                  <span>Your Budget</span>
                  <strong>€{money(transferBudget)}</strong>
                </div>
              </div>

              <div className={styles.gameDateNotice}>
                📅 This negotiation uses the game calendar:
                <strong>{formatDate(gameDate)}</strong>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={() => setShowNegotiation(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.submitButton}
                  disabled={negotiating}
                  onClick={submitNegotiation}
                >
                  {negotiating ? 'Sending...' : 'Submit Offer'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
