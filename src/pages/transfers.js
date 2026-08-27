// pages/transfer.js

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  writeBatch,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './transfer.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const CONTRACT_WAIT_DAYS = 3;
const JOIN_DELAY_DAYS = 1;

const TRANSFER_RESPONSE_DAYS = 2;

const MAX_SUGGESTIONS = 8;
const MAX_AI_TRANSFERS_PER_DAY = 10;
const MAX_AI_CONTRACTS_PER_DAY = 10;

const FIRESTORE_BATCH_SIZE = 450;

const YOUTH_COLLECTION = 'youthPlayers';

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
    player?.overall ??
      player?.rating ??
      player?.overallRating,
    0
  );
}

function playerValue(player) {
  return safeNumber(
    player?.marketValue ??
      player?.value ??
      player?.askingPrice,
    0
  );
}

function askingPrice(player) {
  return safeNumber(
    player?.askingPrice ??
      player?.transferFee ??
      playerValue(player),
    0
  );
}

function clubId(player) {
  return (
    player?.clubId ||
    player?.currentClub ||
    player?.teamId ||
    null
  );
}

function clubName(player) {
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
    value.seconds
  ) {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
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

/* =========================================================
   GAME CALENDAR HELPERS
========================================================= */

/*
  IMPORTANT:

  All transfer timing uses the game's currentDate.

  Never use real Date.now() to determine whether a transfer
  response is due.

  The real Date object is only used to convert the stored
  game-calendar date into a comparable date object.
*/

function gameDateValue(value) {
  return dateValue(value);
}

function addGameDays(date, days) {
  const base = gameDateValue(date) || new Date();

  return new Date(
    base.getTime() +
      safeNumber(days, 0) *
      24 *
      60 *
      60 *
      1000
  ).toISOString();
}

function gameDaysSince(fromDate, currentGameDate) {
  const from = gameDateValue(fromDate);
  const current = gameDateValue(currentGameDate);

  if (!from || !current) return 0;

  return Math.floor(
    (current.getTime() - from.getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

function gameDaysRemaining(deadline, currentGameDate) {
  const end = gameDateValue(deadline);
  const current = gameDateValue(currentGameDate);

  if (!end || !current) return null;

  return Math.ceil(
    (end.getTime() - current.getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

function offerStatus(offer) {
  return normalize(
    offer?.status || 'pending'
  );
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

    case 'contract-offered':
      return 'Contract Offered';

    case 'contract-accepted':
      return 'Contract Accepted';

    case 'joining':
      return 'Joining Club';

    case 'completed':
      return 'Completed';

    case 'expired':
      return 'Expired';

    default:
      return status || 'Pending';
  }
}

function statusClass(status) {
  const value = normalize(status);

  if (
    value === 'accepted' ||
    value === 'contract-accepted' ||
    value === 'completed'
  ) {
    return 'success';
  }

  if (
    value === 'rejected' ||
    value === 'expired'
  ) {
    return 'danger';
  }

  if (
    value === 'negotiation' ||
    value === 'contract-offered' ||
    value === 'joining'
  ) {
    return 'warning';
  }

  return 'pending';
}

/* =========================================================
   GAME DATE NORMALIZATION
========================================================= */

function getCareerGameDate(careerData) {
  const value =
    careerData?.currentDate ||
    careerData?.gameDate ||
    careerData?.calendarDate;

  return gameDateValue(value);
}

/* =========================================================
   AI PLAYER EVALUATION
========================================================= */

function getPositionNeed(clubPlayers) {
  const positions = {};

  clubPlayers.forEach((player) => {
    const position = normalize(
      playerPosition(player)
    );

    if (!position) return;

    positions[position] = (positions[position] || 0) + 1;
  });

  return positions;
}

function calculateAIPlayerScore(
  player,
  aiClub,
  aiPlayers
) {
  const overall = playerOverall(player);
  const value = playerValue(player);

  const budget = safeNumber(
    aiClub.transferBudget,
    0
  );

  const positions =
    getPositionNeed(aiPlayers);

  const position = normalize(
    playerPosition(player)
  );

  let score = 0;

  /*
    Overall quality
  */

  score += overall * 2;

  /*
    Position need
  */

  if (!positions[position]) {
    score += 45;
  } else if (positions[position] < 2) {
    score += 25;
  } else if (positions[position] < 3) {
    score += 10;
  }

  /*
    Budget
  */

  if (
    budget > 0 &&
    value > 0 &&
    value <= budget
  ) {
    score += 30;
  }

  /*
    Young players
  */

  const age = safeNumber(
    player.age,
    28
  );

  if (age <= 21) {
    score += 30;
  } else if (age <= 23) {
    score += 20;
  } else if (age <= 26) {
    score += 10;
  }

  /*
    Transfer listed
  */

  const transferStatus =
    normalize(
      player.transferStatus
    );

  if (
    transferStatus.includes('listed') ||
    transferStatus.includes('available') ||
    transferStatus.includes('transfer')
  ) {
    score += 20;
  }

  /*
    Potential
  */

  const potential = safeNumber(
    player.potential,
    overall
  );

  score += Math.min(
    20,
    Math.max(
      0,
      potential - overall
    )
  );

  /*
    Reputation
  */

  const reputation = safeNumber(
    aiClub.reputation,
    50
  );

  if (overall >= 80 && reputation >= 70) {
    score += 20;
  }

  return score;
}

/* =========================================================
   AI BID NEGOTIATION
========================================================= */

function aiNegotiateBid(
  offer,
  player,
  sellingClub,
  buyerClub
) {
  const overall = playerOverall(player);

  const value = playerValue(player);

  const asking = safeNumber(
    offer.askingPrice || askingPrice(player),
    value
  );

  const amount = safeNumber(
    offer.offerAmount,
    0
  );

  let acceptChance = 0.25;

  /*
    Offer compared to asking price
  */

  if (asking > 0) {
    const ratio =
      amount / asking;

    if (ratio >= 1.5) {
      acceptChance += 0.45;
    } else if (ratio >= 1.3) {
      acceptChance += 0.35;
    } else if (ratio >= 1.1) {
      acceptChance += 0.25;
    } else if (ratio >= 1.0) {
      acceptChance += 0.15;
    } else if (ratio >= 0.9) {
      acceptChance += 0.05;
    } else {
      acceptChance -= 0.15;
    }
  }

  /*
    High-quality player
    = harder to buy cheaply
  */

  if (overall >= 90) {
    acceptChance -= 0.20;
  } else if (overall >= 85) {
    acceptChance -= 0.15;
  } else if (overall >= 80) {
    acceptChance -= 0.10;
  } else if (overall >= 75) {
    acceptChance -= 0.05;
  }

  /*
    Transfer listed
    = easier to sell
  */

  const transferStatus =
    normalize(
      player.transferStatus
    );

  if (
    transferStatus.includes('listed') ||
    transferStatus.includes('available')
  ) {
    acceptChance += 0.20;
  }

  /*
    Seller reputation / pressure
  */

  const sellerReputation =
    safeNumber(
      sellingClub?.reputation,
      50
    );

  if (sellerReputation < 40) {
    acceptChance += 0.05;
  }

  /*
    Clamp
  */

  acceptChance = Math.max(
    0.05,
    Math.min(
      0.95,
      acceptChance
    )
  );

  const roll = Math.random();

  /*
    ACCEPT
  */

  if (roll < acceptChance) {
    return {
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      systemResponse: true,
      responseNote:
        `The selling club accepted the €${money(amount)} offer.`,
    };
  }

  /*
    COUNTER OFFER
  */

  const counterChance = 0.55;

  if (
    Math.random() < counterChance &&
    asking > amount
  ) {
    let counterOffer =
      Math.round(
        asking * (
          0.90 +
          Math.random() * 0.15
        )
      );

    /* Never counter above buyer budget if budget is known. */
    const buyerBudget = safeNumber(
      buyerClub?.transferBudget,
      0
    );
    if (
      buyerBudget > 0 &&
      counterOffer > buyerBudget
    ) {
      counterOffer = buyerBudget;
    }

    if (counterOffer > amount) {
      return {
        status: 'negotiation',
        counterOffer,
        systemResponse: true,
        responseNote:
          `The selling club rejected the offer but wants €${money(counterOffer)}.`,
      };
    }
  }

  /*
    REJECT
  */

  return {
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    systemResponse: true,
    responseNote:
      'The selling club rejected the transfer offer.',
  };
}

/* =========================================================
   AI CONTRACT NEGOTIATION
========================================================= */

function aiNegotiateContract(
  offer,
  player,
  club
) {
  const overall =
    playerOverall(player);

  const offeredWage =
    safeNumber(
      offer.weeklyWage,
      0
    );

  const currentWage =
    safeNumber(
      player.wage ||
      player.salary,
      0
    );

  let acceptChance = 0.30;

  if (currentWage > 0) {
    const ratio =
      offeredWage /
      currentWage;

    if (ratio >= 2) {
      acceptChance += 0.40;
    } else if (ratio >= 1.5) {
      acceptChance += 0.30;
    } else if (ratio >= 1.2) {
      acceptChance += 0.20;
    } else if (ratio >= 1) {
      acceptChance += 0.10;
    } else {
      acceptChance -= 0.25;
    }
  }

  if (overall >= 90) {
    acceptChance -= 0.15;
  } else if (overall >= 80) {
    acceptChance -= 0.10;
  } else if (overall >= 75) {
    acceptChance -= 0.05;
  }

  const reputation =
    safeNumber(
      club?.reputation,
      50
    );

  if (reputation >= 80) {
    acceptChance += 0.10;
  }

  acceptChance = Math.max(
    0.05,
    Math.min(
      0.90,
      acceptChance
    )
  );

  if (
    Math.random() <
    acceptChance
  ) {
    return {
      status: 'contract-accepted',
      acceptedAt:
        new Date().toISOString(),
      systemResponse: true,
      responseNote:
        `${playerName(player)} accepted the contract.`,
    };
  }

  return {
    status: 'rejected',
    rejectedAt:
      new Date().toISOString(),
    systemResponse: true,
    responseNote:
      `${playerName(player)} rejected the contract.`,
  };
}

/* =========================================================
   AI OFFER CREATION
========================================================= */

function createAIBid({
  aiClub,
  player,
  gameDate,
}) {
  const value =
    playerValue(player);

  const asking =
    askingPrice(player);

  const baseValue =
    asking > 0
      ? asking
      : value > 0
      ? value
      : 100000;

  const offerAmount =
    Math.max(
      1,
      Math.round(
        baseValue *
        (
          0.78 +
          Math.random() * 0.27
        )
      )
    );

  return {
    id:
      `ai-${aiClub.id}-${player.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,

    buyerClubId: aiClub.id,
    buyerClubName:
      aiClub.name ||
      aiClub.clubName ||
      'AI Club',
    playerId: player.id,
    playerName: playerName(player),
    offerAmount,
    askingPrice: asking,
    type: 'transfer',
    status: 'pending',
    createdBy: 'system-ai',
    createdAt: gameDate.toISOString(),
    responseDeadline: addGameDays(
      gameDate,
      TRANSFER_RESPONSE_DAYS
    ),
  };
}

/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [
      playersSnapshot,
      clubsSnapshot,
    ] = await Promise.all([
      getDocs(
        collection(db, 'players')
      ),
      getDocs(
        collection(db, 'clubs')
      ),
    ]);

    const players = playersSnapshot.docs.map(
      (item) => ({
        id: item.id,
        ...item.data(),
      })
    );

    const clubs = clubsSnapshot.docs.map(
      (item) => ({
        id: item.id,
        ...item.data(),
      })
    );

    return {
      props: {
        initialPlayers: JSON.parse(
          JSON.stringify(players)
        ),
        initialClubs: JSON.parse(
          JSON.stringify(clubs)
        ),
      },
    };
  } catch (error) {
    console.error(
      'Transfer SSR error:',
      error
    );

    return {
      props: {
        initialPlayers: [],
        initialClubs: [],
      },
    };
  }
}

/* =========================================================
   PAGE
========================================================= */

export default function TransferPage({
  initialPlayers = [],
  initialClubs = [],
}) {
  const router =
    useRouter();

  const {
    user,
    loading,
  } = useAuth();

  const [
    players,
    setPlayers,
  ] = useState(
    initialPlayers
  );

  const [
    clubs,
    setClubs,
  ] = useState(
    initialClubs
  );

  const [
    youthPlayers,
    setYouthPlayers,
  ] = useState([]);

  const [
    careerData,
    setCareerData,
  ] = useState(null);

  const [
    currentClub,
    setCurrentClub,
  ] = useState(null);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    activeTab,
    setActiveTab,
  ] = useState('incoming');

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    statusFilter,
    setStatusFilter,
  ] = useState('all');

  const [
    selectedBid,
    setSelectedBid,
  ] = useState(null);

  const [
    showBidModal,
    setShowBidModal,
  ] = useState(false);

  const [
    showContractModal,
    setShowContractModal,
  ] = useState(false);

  const [
    contractPlayer,
    setContractPlayer,
  ] = useState(null);

  const [
    contractWage,
    setContractWage,
  ] = useState('');

  const [
    contractBonus,
    setContractBonus,
  ] = useState('');

  const [
    contractYears,
    setContractYears,
  ] = useState('3');

  const [
    contractLoading,
    setContractLoading,
  ] = useState(false);

  const [
    isProcessingSystem,
    setIsProcessingSystem,
  ] = useState(false);

  /*
    Prevent processing the same game date repeatedly.
  */

  const processedCalendarRef =
    useRef(new Set());

  /* =======================================================
     CURRENT GAME DATE
  ======================================================= */

  const currentGameDate =
    useMemo(
      () =>
        getCareerGameDate(
          careerData
        ),
      [careerData]
    );

  const currentGameDateKey =
    currentGameDate
      ? currentGameDate
          .toISOString()
          .slice(0, 10)
      : null;

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (
      !loading &&
      !user
    ) {
      router.push('/login');
      return;
    }

    if (user) {
      loadCareer();
    }
  }, [
    user,
    loading,
    router,
  ]);

  /* =======================================================
     LOAD CAREER
  ======================================================= */

  async function loadCareer() {
    try {
      setIsLoading(true);

      const userRef = doc(
        db,
        'users',
        user.uid
      );

      const snapshot = await getDoc(
        userRef
      );

      if (!snapshot.exists()) {
        setCareerData({});
        return;
      }

      const data = snapshot.data();
      const career = data.careerData || {};
      setCareerData(career);

      if (career.currentClub) {
        const clubRef = doc(
          db,
          'clubs',
          career.currentClub
        );

        const clubSnapshot = await getDoc(
          clubRef
        );

        if (
          clubSnapshot.exists()
        ) {
          setCurrentClub({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }
      }
    } catch (error) {
      console.error(error);
      toast.error(
        'Could not load transfer centre'
      );
    } finally {
      setIsLoading(false);
    }
  }

  /* =======================================================
     REALTIME PLAYERS
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(
        db,
        'players'
      ),
      (snapshot) => {
        const playerList = snapshot.docs.map(
          (docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          })
        );

        setPlayers(playerList);
      },
      (error) => {
        console.error(
          'Players realtime error:',
          error
        );
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     REALTIME CLUBS
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(
        db,
        'clubs'
      ),
      (snapshot) => {
        const clubList = snapshot.docs.map(
          (docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          })
        );

        setClubs(clubList);
      },
      (error) => {
        console.error(
          'Clubs realtime error:',
          error
        );
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     REALTIME YOUTH PLAYERS
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(
        db,
        YOUTH_COLLECTION
      ),
      (snapshot) => {
        const list = snapshot.docs.map(
          (docItem) => ({
            id: docItem.id,
            ...docItem.data(),
          })
        );

        setYouthPlayers(list);
      },
      (error) => {
        /*
          Youth collection may not exist in some installations.
          Do not crash the transfer centre.
        */
        console.warn(
          'Youth players realtime error:',
          error
        );
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     CLUB MAP
  ======================================================= */

  const clubMap =
    useMemo(() => {
      return clubs.reduce(
        (map, club) => {
          map[club.id] =
            club;

          return map;
        },
        {}
      );
    }, [clubs]);

  /* =======================================================
     PLAYER MAP
  ======================================================= */

  const playerMap =
    useMemo(() => {
      return players.reduce(
        (map, player) => {
          map[player.id] =
            player;

          return map;
        },
        {}
      );
    }, [players]);

  /* =======================================================
     CURRENT CLUB
  ======================================================= */

  const currentClubId =
    careerData?.currentClub ||
    null;

  const currentClubPlayers =
    useMemo(() => {
      if (!currentClubId) {
        return [];
      }

      return players.filter(
        (player) =>
          clubId(player) ===
          currentClubId
      );
    }, [
      players,
      currentClubId,
    ]);

  /* =======================================================
     UPDATE PLAYER
  ======================================================= */

  async function updatePlayer(
    playerId,
    data
  ) {
    try {
      await updateDoc(
        doc(
          db,
          'players',
          playerId
        ),
        {
          ...data,
          updatedAt:
            serverTimestamp(),
        }
      );

      setPlayers(
        (previous) =>
          previous.map(
            (player) =>
              player.id === playerId
                ? {
                    ...player,
                    ...data,
                  }
                : player
          )
      );

      return true;
    } catch (error) {
      console.error(error);
      toast.error(
        'Could not update player'
      );
      return false;
    }
  }

  /* =======================================================
     SYSTEM BID RESPONSES
     GAME CALENDAR ONLY
  ======================================================= */

  const processSystemResponses =
    useCallback(
      async () => {
        if (
          !user ||
          !currentClub ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        try {
          setIsProcessingSystem(true);

          const gameDate = currentGameDate;

          const updates = [];

          /*
            AI/system seller clubs only.
          */

          for (const player of players) {
            const sellerClubId = clubId(player);

            if (!sellerClubId) {
              continue;
            }

            /*
              Current user's club is handled manually.
            */

            if (
              sellerClubId ===
              currentClub.id
            ) {
              continue;
            }

            const sellerClub =
              clubMap[sellerClubId];

            /*
              If the club has a managerId,
              it is controlled by a user.
            */

            if (sellerClub?.managerId) {
              continue;
            }

            const offers = Array.isArray(
              player.transferOffers
            )
              ? player.transferOffers
              : [];

            if (offers.length === 0) {
              continue;
            }

            let changed = false;

            const updatedOffers = [...offers];

            for (
              let index = 0;
              index < updatedOffers.length;
              index++
            ) {
              const offer = updatedOffers[index];

              if (
                offerStatus(offer) !==
                'pending'
              ) {
                continue;
              }

              const offerDate = dateValue(
                offer.createdAt
              );

              if (!offerDate) {
                continue;
              }

              const daysSince = gameDaysSince(
                offerDate,
                gameDate
              );

              if (
                daysSince <
                TRANSFER_RESPONSE_DAYS
              ) {
                continue;
              }

              const buyerClub =
                clubMap[offer.buyerClubId];

              /*
                If buyer no longer exists,
                reject safely.
              */

              if (!buyerClub) {
                updatedOffers[index] = {
                  ...offer,
                  status: 'rejected',
                  rejectedAt: gameDate.toISOString(),
                  systemResponse: true,
                  responseNote:
                    'Transfer rejected because the buying club no longer exists.',
                };
                changed = true;
                continue;
              }

              const response = aiNegotiateBid(
                offer,
                player,
                sellerClub,
                buyerClub
              );

              updatedOffers[index] = {
                ...offer,
                ...response,
              };

              changed = true;

              /*
                ACCEPTED TRANSFER
              */

              if (
                response.status ===
                'accepted'
              ) {
                updatedOffers[index] = {
                  ...updatedOffers[index],
                  acceptedAt: gameDate.toISOString(),
                  joiningDate: addGameDays(
                    gameDate,
                    JOIN_DELAY_DAYS
                  ),
                  status: 'joining',
                };

                updates.push({
                  player,
                  updatedOffers,
                  pendingTransfer: {
                    ...updatedOffers[index],
                    fromClubId: sellerClubId,
                    fromClubName:
                      sellerClub?.name ||
                      clubName(player),
                    toClubId:
                      offer.buyerClubId,
                    toClubName:
                      buyerClub?.name ||
                      offer.buyerClubName,
                    joiningDate: addGameDays(
                      gameDate,
                      JOIN_DELAY_DAYS
                    ),
                    status: 'joining',
                  },
                });
              }
            }

            if (!changed) {
              continue;
            }

            updates.push({
              player,
              updatedOffers,
              pendingTransfer: null,
            });
          }

          /*
            Commit all player changes.
          */

          if (updates.length > 0) {
            const batch = writeBatch(db);
            let count = 0;

            for (const item of updates) {
              if (
                count >=
                FIRESTORE_BATCH_SIZE
              ) {
                break;
              }

              const {
                player,
                updatedOffers,
                pendingTransfer,
              } = item;

              const latest =
                updatedOffers[
                  updatedOffers.length - 1
                ];

              const updateData = {
                transferOffers: updatedOffers,
                latestOffer: latest,
                transferStatus:
                  latest?.status ||
                  player.transferStatus ||
                  'available',
                updatedAt:
                  serverTimestamp(),
              };

              if (pendingTransfer) {
                updateData.pendingTransfer =
                  pendingTransfer;
              } else {
                updateData.pendingTransfer =
                  null;
              }

              batch.update(
                doc(
                  db,
                  'players',
                  player.id
                ),
                updateData
              );

              count++;
            }

            await batch.commit();

            /*
              Complete accepted transfers separately
              using the game date.
            */

            await completeDueTransfers(
              gameDate
            );
          }
        } catch (error) {
          console.error(
            'System processing error:',
            error
          );
        } finally {
          setIsProcessingSystem(false);
        }
      },
      [
        user,
        currentClub,
        currentGameDate,
        players,
        clubMap,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     COMPLETE ACCEPTED TRANSFERS
  ======================================================= */

  async function completeDueTransfers(
    gameDate
  ) {
    if (!gameDate) return;

    const dueTransfers = [];

    players.forEach((player) => {
      const pending =
        player.pendingTransfer;

      if (
        !pending ||
        normalize(pending.status) !==
          'joining'
      ) {
        return;
      }

      const joiningDate = dateValue(
        pending.joiningDate
      );

      if (!joiningDate) {
        return;
      }

      if (
        joiningDate.getTime() >
        gameDate.getTime()
      ) {
        return;
      }

      dueTransfers.push({
        player,
        pending,
      });
    });

    if (dueTransfers.length === 0) {
      return;
    }

    const batch = writeBatch(db);
    let count = 0;

    for (const item of dueTransfers) {
      if (
        count >=
        FIRESTORE_BATCH_SIZE
      ) {
        break;
      }

      const {
        player,
        pending,
      } = item;

      const fromClubId =
        pending.fromClubId ||
        clubId(player);

      const toClubId =
        pending.toClubId;

      if (!toClubId) {
        continue;
      }

      const transferFee = safeNumber(
        pending.offerAmount,
        0
      );

      const sellerClub =
        clubMap[fromClubId];

      const buyerClub =
        clubMap[toClubId];

      if (!buyerClub) {
        continue;
      }

      /*
        Remove player from seller
        and put him at buyer.
      */

      const playerRef = doc(
        db,
        'players',
        player.id
      );

      const newClubName =
        buyerClub.name ||
        buyerClub.clubName ||
        '';

      const updateData = {
        clubId: toClubId,
        currentClub: toClubId,
        teamId: toClubId,
        clubName: newClubName,
        currentClubName: newClubName,
        transferStatus: 'completed',
        pendingTransfer: null,
        lastTransferFee: transferFee,
        lastTransferDate:
          gameDate.toISOString(),
        updatedAt:
          serverTimestamp(),
      };

      /*
        Auto contract offer for joining player.
      */

      const weeklyWage = Math.round(
        (
          player.wage ||
          player.salary ||
          1000
        ) * 1.2
      );

      const autoContract = {
        id: `auto-contract-${toClubId}-${player.id}-${Date.now()}`,
        clubId: toClubId,
        clubName: newClubName,
        playerId: player.id,
        playerName: playerName(player),
        weeklyWage,
        signingBonus: 0,
        years: 3,
        status: 'contract-offered',
        negotiationRound: 1,
        secondChanceUsed: false,
        createdAt: gameDate.toISOString(),
        responseDeadline: addGameDays(
          gameDate,
          CONTRACT_WAIT_DAYS
        ),
        createdBy: 'system-ai',
      };

      const existingContracts = Array.isArray(
        player.contractOffers
      )
        ? player.contractOffers
        : [];

      updateData.contractOffers = [
        ...existingContracts,
        autoContract,
      ];

      updateData.latestContractOffer =
        autoContract;

      batch.update(
        playerRef,
        updateData
      );

      /*
        Buyer budget.
      */

      if (transferFee > 0) {
        const buyerBudget = safeNumber(
          buyerClub.transferBudget,
          0
        );

        batch.update(
          doc(
            db,
            'clubs',
            toClubId
          ),
          {
            transferBudget: Math.max(
              0,
              buyerBudget - transferFee
            ),
            updatedAt:
              serverTimestamp(),
          }
        );

        /*
          Seller receives money.
        */

        if (sellerClub) {
          const sellerBudget = safeNumber(
            sellerClub.transferBudget,
            0
          );

          batch.update(
            doc(
              db,
              'clubs',
              fromClubId
            ),
            {
              transferBudget:
                sellerBudget + transferFee,
              updatedAt:
                serverTimestamp(),
            }
          );
        }
      }

      count++;
    }

    if (count > 0) {
      await batch.commit();

      toast.success(
        `${count} transfer${count > 1 ? 's' : ''} completed`
      );
    }
  }

  /* =======================================================
     SYSTEM CONTRACT RESPONSES
     GAME CALENDAR ONLY
  ======================================================= */

  const processSystemContractResponses =
    useCallback(
      async () => {
        if (
          !user ||
          !currentClub ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        try {
          setIsProcessingSystem(true);

          const gameDate = currentGameDate;

          const batch = writeBatch(db);
          let updateCount = 0;

          players.forEach((player) => {
            if (
              updateCount >=
              FIRESTORE_BATCH_SIZE
            ) {
              return;
            }

            const offers = Array.isArray(
              player.contractOffers
            )
              ? player.contractOffers
              : [];

            if (offers.length === 0) {
              return;
            }

            const updatedOffers = [...offers];
            let changed = false;

            offers.forEach(
              (offer, index) => {
                if (
                  offerStatus(offer) !==
                  'contract-offered'
                ) {
                  return;
                }

                const offerDate = dateValue(
                  offer.createdAt
                );

                if (!offerDate) {
                  return;
                }

                const daysSince = gameDaysSince(
                  offerDate,
                  gameDate
                );

                if (
                  daysSince <
                  TRANSFER_RESPONSE_DAYS
                ) {
                  return;
                }

                const response =
                  aiNegotiateContract(
                    offer,
                    player,
                    currentClub
                  );

                updatedOffers[index] = {
                  ...offer,
                  ...response,
                };

                changed = true;
              }
            );

            if (!changed) {
              return;
            }

            const latest =
              updatedOffers[
                updatedOffers.length - 1
              ];

            batch.update(
              doc(
                db,
                'players',
                player.id
              ),
              {
                contractOffers: updatedOffers,
                latestContractOffer: latest,
                updatedAt:
                  serverTimestamp(),
              }
            );

            updateCount++;
          });

          if (updateCount > 0) {
            await batch.commit();

            toast.success(
              `System processed ${updateCount} contract offers`
            );
          }
        } catch (error) {
          console.error(
            'System contract processing error:',
            error
          );
        } finally {
          setIsProcessingSystem(false);
        }
      },
      [
        user,
        currentClub,
        currentGameDate,
        players,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     AI TRANSFER MARKET
  ======================================================= */

  const processSystemAITransfers =
    useCallback(
      async () => {
        if (
          !user ||
          !currentClub ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        const gameDate = currentGameDate;

        /*
          One processing cycle per game day.
        */

        const dateKey = gameDate
          .toISOString()
          .slice(0, 10);

        if (
          processedCalendarRef.current.has(
            `ai-${dateKey}`
          )
        ) {
          return;
        }

        try {
          setIsProcessingSystem(true);

          /*
            Transfer window follows GAME CALENDAR,
            not real-world date.
          */

          const month = gameDate.getUTCMonth();
          const isSummerWindow =
            month >= 5 && month <= 7;
          const isWinterWindow =
            month === 0;

          if (
            !isSummerWindow &&
            !isWinterWindow
          ) {
            processedCalendarRef.current.add(
              `ai-${dateKey}`
            );
            return;
          }

          /*
            AI clubs have no managerId.
          */

          const aiClubs = clubs.filter(
            (club) =>
              !club.managerId &&
              club.id !== currentClub.id
          );

          if (aiClubs.length === 0) {
            processedCalendarRef.current.add(
              `ai-${dateKey}`
            );
            return;
          }

          /*
            We collect updates first.
          */

          const operations = [];
          let transferCount = 0;

          for (const aiClub of aiClubs) {
            if (
              transferCount >=
              MAX_AI_TRANSFERS_PER_DAY
            ) {
              break;
            }

            const budget = safeNumber(
              aiClub.transferBudget,
              0
            );

            if (budget <= 0) {
              continue;
            }

            const aiSquad = players.filter(
              (player) =>
                clubId(player) === aiClub.id
            );

            /*
              Candidates from senior players.
            */

            const seniorCandidates = players.filter(
              (player) => {
                const pClub = clubId(player);

                if (
                  !pClub ||
                  pClub === aiClub.id
                ) {
                  return false;
                }

                /*
                  Don't target players already
                  involved in a completed transfer.
                */

                if (
                  normalize(
                    player.transferStatus
                  ) === 'completed'
                ) {
                  return false;
                }

                /*
                  Don't target players with
                  a pending transfer.
                */

                if (player.pendingTransfer) {
                  return false;
                }

                const status = normalize(
                  player.transferStatus
                );

                /*
                  AI can scout normal players
                  and transfer-listed players.
                */

                return (
                  status.includes('listed') ||
                  status.includes('available') ||
                  status.includes('transfer') ||
                  Math.random() < 0.20
                );
              }
            );

            /*
              Youth candidates.
            */

            const youthCandidates = youthPlayers.filter(
              (player) => {
                const pClub = clubId(player);

                if (pClub === aiClub.id) {
                  return false;
                }

                if (player.pendingTransfer) {
                  return false;
                }

                return true;
              }
            );

            /*
              Combine both markets.
            */

            const candidates = [
              ...seniorCandidates.map(
                (player) => ({
                  player,
                  source: 'players',
                })
              ),
              ...youthCandidates.map(
                (player) => ({
                  player,
                  source: 'youthPlayers',
                })
              ),
            ];

            if (candidates.length === 0) {
              continue;
            }

            /*
              Score candidates.
            */

            const scored = candidates
              .map(
                ({ player, source }) => ({
                  player,
                  source,
                  score: calculateAIPlayerScore(
                    player,
                    aiClub,
                    aiSquad
                  ),
                })
              )
              .sort(
                (a, b) =>
                  b.score - a.score
              );

            /*
              AI does not always buy the #1 player.
              It chooses from the best candidates.
            */

            const topCandidates = scored.slice(
              0,
              Math.min(
                5,
                scored.length
              )
            );

            if (topCandidates.length === 0) {
              continue;
            }

            const selected =
              topCandidates[
                Math.floor(
                  Math.random() *
                    topCandidates.length
                )
              ];

            const targetPlayer =
              selected.player;

            const value = playerValue(
              targetPlayer
            );

            const asking = askingPrice(
              targetPlayer
            );

            const estimatedCost =
              asking > 0
                ? asking
                : value;

            if (
              estimatedCost > budget &&
              estimatedCost > 0
            ) {
              continue;
            }

            /*
              Prevent duplicate AI bids.
            */

            const existingOffers = Array.isArray(
              targetPlayer.transferOffers
            )
              ? targetPlayer.transferOffers
              : [];

            const duplicate = existingOffers.some(
              (offer) =>
                offer.buyerClubId ===
                  aiClub.id &&
                (
                  offerStatus(offer) ===
                    'pending' ||
                  offerStatus(offer) ===
                    'negotiation'
                )
            );

            if (duplicate) {
              continue;
            }

            const bid = createAIBid({
              aiClub,
              player: targetPlayer,
              gameDate,
            });

            /*
              If the AI is buying a youth player,
              the player must eventually become
              a normal player.
            */

            operations.push({
              aiClub,
              player: targetPlayer,
              source: selected.source,
              bid,
            });

            transferCount++;
          }

          /*
            WRITE AI BIDS
          */

          if (operations.length > 0) {
            const batch = writeBatch(db);
            let count = 0;

            for (const operation of operations) {
              if (
                count >=
                FIRESTORE_BATCH_SIZE
              ) {
                break;
              }

              const {
                player,
                bid,
              } = operation;

              const existing = Array.isArray(
                player.transferOffers
              )
                ? player.transferOffers
                : [];

              batch.update(
                doc(
                  db,
                  'players',
                  player.id
                ),
                {
                  transferOffers: [
                    ...existing,
                    bid,
                  ],
                  latestOffer: bid,
                  transferStatus: 'available',
                  updatedAt:
                    serverTimestamp(),
                }
              );

              count++;
            }

            await batch.commit();

            toast.success(
              `AI clubs submitted ${count} transfer bids`
            );
          }

          processedCalendarRef.current.add(
            `ai-${dateKey}`
          );
        } catch (error) {
          console.error(
            'AI transfer market error:',
            error
          );
        } finally {
          setIsProcessingSystem(false);
        }
      },
      [
        user,
        currentClub,
        currentGameDate,
        players,
        youthPlayers,
        clubs,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     AI CONTRACT SIGNING
  ======================================================= */

  const processAIContractSignings =
    useCallback(
      async () => {
        if (
          !user ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        const gameDate = currentGameDate;

        const dateKey = gameDate
          .toISOString()
          .slice(0, 10);

        const processKey =
          `contracts-${dateKey}`;

        if (
          processedCalendarRef.current.has(
            processKey
          )
        ) {
          return;
        }

        try {
          setIsProcessingSystem(true);

          /*
            AI clubs look at players
            who have recently joined them.
          */

          const aiClubs = clubs.filter(
            (club) => !club.managerId
          );

          if (aiClubs.length === 0) {
            processedCalendarRef.current.add(
              processKey
            );
            return;
          }

          const batch = writeBatch(db);
          let count = 0;

          for (const aiClub of aiClubs) {
            if (
              count >=
              MAX_AI_CONTRACTS_PER_DAY
            ) {
              break;
            }

            const squad = players.filter(
              (player) =>
                clubId(player) === aiClub.id
            );

            /*
              Players without contract
              or with expiring contract.
            */

            const candidates = squad.filter(
              (player) => {
                if (
                  player.contractOffers &&
                  Array.isArray(
                    player.contractOffers
                  )
                ) {
                  const active =
                    player.contractOffers.some(
                      (offer) =>
                        offerStatus(offer) ===
                          'contract-offered' ||
                        offerStatus(offer) ===
                          'contract-accepted'
                    );

                  if (active) {
                    return false;
                  }
                }

                return true;
              }
            );

            for (const player of candidates) {
              if (
                count >=
                MAX_AI_CONTRACTS_PER_DAY
              ) {
                break;
              }

              const overall = playerOverall(
                player
              );

              /*
                Stronger players receive
                stronger contracts.
              */

              const currentWage = safeNumber(
                player.wage ||
                player.salary,
                500
              );

              const wageMultiplier =
                overall >= 85
                  ? 1.45
                  : overall >= 75
                  ? 1.30
                  : 1.15;

              const weeklyWage = Math.round(
                currentWage * wageMultiplier
              );

              const contract = {
                id: `ai-contract-${aiClub.id}-${player.id}-${Date.now()}`,
                clubId: aiClub.id,
                clubName:
                  aiClub.name ||
                  aiClub.clubName ||
                  '',
                playerId: player.id,
                playerName: playerName(
                  player
                ),
                weeklyWage,
                signingBonus: Math.round(
                  weeklyWage * 4
                ),
                years: overall >= 80 ? 4 : 3,
                status: 'contract-offered',
                negotiationRound: 1,
                secondChanceUsed: false,
                createdAt: gameDate.toISOString(),
                responseDeadline: addGameDays(
                  gameDate,
                  TRANSFER_RESPONSE_DAYS
                ),
                createdBy: 'system-ai',
              };

              const existing = Array.isArray(
                player.contractOffers
              )
                ? player.contractOffers
                : [];

              batch.update(
                doc(
                  db,
                  'players',
                  player.id
                ),
                {
                  contractOffers: [
                    ...existing,
                    contract,
                  ],
                  latestContractOffer: contract,
                  updatedAt:
                    serverTimestamp(),
                }
              );

              count++;
            }
          }

          if (count > 0) {
            await batch.commit();

            toast.success(
              `AI clubs sent ${count} contract offers`
            );
          }

          processedCalendarRef.current.add(
            processKey
          );
        } catch (error) {
          console.error(
            'AI contract signing error:',
            error
          );
        } finally {
          setIsProcessingSystem(false);
        }
      },
      [
        user,
        currentGameDate,
        clubs,
        players,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     RUN GAME-CALENDAR PROCESSING
  ======================================================= */

  useEffect(() => {
    if (
      !user ||
      !currentClub ||
      !currentGameDate
    ) {
      return;
    }

    /*
      IMPORTANT:

      This effect is triggered by the game's currentDate.
      It does NOT use real-world time.

      When the player advances from:
        2026-08-20
      to:
        2026-08-21

      the transfer system processes that game day.
    */

    const run = async () => {
      await processSystemResponses();
      await processSystemContractResponses();
      await processSystemAITransfers();
      await processAIContractSignings();

      /*
        Complete accepted transfers
        according to GAME DATE.
      */

      await completeDueTransfers(
        currentGameDate
      );
    };

    run();
  }, [
    user,
    currentClub,
    currentGameDateKey,
    processSystemResponses,
    processSystemContractResponses,
    processSystemAITransfers,
    processAIContractSignings,
  ]);

  /* =======================================================
     INCOMING BIDS
  ======================================================= */

  const incomingBids =
    useMemo(() => {
      const result = [];

      currentClubPlayers.forEach(
        (player) => {
          const offers = Array.isArray(
            player.transferOffers
          )
            ? player.transferOffers
            : [];

          offers.forEach(
            (offer, index) => {
              if (
                !offer ||
                offer.type === 'loan'
              ) {
                return;
              }

              const buyerClubId =
                offer.buyerClubId ||
                offer.fromClubId ||
                offer.clubId;

              if (
                buyerClubId ===
                currentClubId
              ) {
                return;
              }

              result.push({
                ...offer,
                player,
                playerId: player.id,
                offerIndex: index,
                id:
                  offer.id ||
                  `${player.id}-${index}`,
                buyerClubName:
                  offer.buyerClubName ||
                  clubMap[buyerClubId]?.name ||
                  'Unknown Club',
                buyerClubId,
              });
            }
          );
        }
      );

      return result.sort(
        (a, b) => {
          const aDate =
            dateValue(a.createdAt)?.getTime() ||
            0;

          const bDate =
            dateValue(b.createdAt)?.getTime() ||
            0;

          return bDate - aDate;
        }
      );
    }, [
      currentClubPlayers,
      currentClubId,
      clubMap,
    ]);

  /* =======================================================
     OUTGOING BIDS
  ======================================================= */

  const outgoingBids =
    useMemo(() => {
      const result = [];

      players.forEach((player) => {
        const offers = Array.isArray(
          player.transferOffers
        )
          ? player.transferOffers
          : [];

        offers.forEach(
          (offer, index) => {
            if (
              !offer ||
              offer.type === 'loan'
            ) {
              return;
            }

            if (
              offer.buyerClubId !==
              currentClubId
            ) {
              return;
            }

            result.push({
              ...offer,
              player,
              playerId: player.id,
              offerIndex: index,
              id:
                offer.id ||
                `${player.id}-${index}`,
            });
          }
        );
      });

      return result.sort(
        (a, b) => {
          const aDate =
            dateValue(a.createdAt)?.getTime() ||
            0;

          const bDate =
            dateValue(b.createdAt)?.getTime() ||
            0;

          return bDate - aDate;
        }
      );
    }, [players, currentClubId]);

  /* =======================================================
     JOINING PLAYERS
  ======================================================= */

  const joiningPlayers =
    useMemo(() => {
      if (!currentClubId) return [];

      return players.filter(
        (player) =>
          player.pendingTransfer &&
          player.pendingTransfer.toClubId ===
            currentClubId &&
          offerStatus(player.pendingTransfer) ===
            'joining'
      );
    }, [players, currentClubId]);

  /* =======================================================
     CONTRACT OFFERS
  ======================================================= */

  const contractOffers =
    useMemo(() => {
      const result = [];

      players.forEach((player) => {
        const offers = Array.isArray(
          player.contractOffers
        )
          ? player.contractOffers
          : [];

        offers.forEach(
          (offer, index) => {
            if (
              offer.clubId !==
              currentClubId
            ) {
              return;
            }

            result.push({
              ...offer,
              player,
              playerId: player.id,
              offerIndex: index,
              id:
                offer.id ||
                `${player.id}-contract-${index}`,
            });
          }
        );
      });

      return result;
    }, [players, currentClubId]);

  /* =======================================================
     FILTERED BIDS
  ======================================================= */

  const visibleBids =
    useMemo(() => {
      let source =
        activeTab === 'incoming'
          ? incomingBids
          : outgoingBids;

      const term = normalize(search);

      if (term) {
        source = source.filter(
          (bid) =>
            normalize(
              playerName(bid.player)
            ).includes(term) ||
            normalize(
              bid.buyerClubName
            ).includes(term)
        );
      }

      if (statusFilter !== 'all') {
        source = source.filter(
          (bid) =>
            normalize(bid.status) ===
            normalize(statusFilter)
        );
      }

      return source;
    }, [
      activeTab,
      incomingBids,
      outgoingBids,
      search,
      statusFilter,
    ]);

  /* =======================================================
     STATS
  ======================================================= */

  const pendingIncoming =
    incomingBids.filter(
      (bid) =>
        offerStatus(bid) === 'pending'
    ).length;

  const pendingOutgoing =
    outgoingBids.filter(
      (bid) =>
        offerStatus(bid) === 'pending' ||
        offerStatus(bid) === 'negotiation'
    ).length;

  const acceptedDeals =
    [
      ...incomingBids,
      ...outgoingBids,
    ].filter(
      (bid) =>
        offerStatus(bid) === 'accepted' ||
        offerStatus(bid) === 'completed'
    ).length;

  const contractWaiting =
    contractOffers.filter(
      (offer) =>
        offerStatus(offer) ===
          'contract-offered' ||
        offerStatus(offer) ===
          'contract-accepted'
    ).length;

  const joiningCount =
    joiningPlayers.length;

  /* =======================================================
     GM SUGGESTIONS
  ======================================================= */

  const suggestions =
    useMemo(() => {
      const budget =
        safeNumber(
          careerData?.transferBudget,
          currentClub?.transferBudget || 0
        );

      const squad = currentClubPlayers;

      const positions = getPositionNeed(
        squad
      );

      return players
        .filter(
          (player) =>
            clubId(player) !== currentClubId
        )
        .map((player) => {
          const position = normalize(
            playerPosition(player)
          );

          const overall = playerOverall(
            player
          );

          const value = playerValue(
            player
          );

          let score = overall * 2;

          const reasons = [];

          if (
            budget > 0 &&
            value <= budget
          ) {
            score += 30;
            reasons.push(
              'Fits transfer budget'
            );
          }

          if (!positions[position]) {
            score += 30;
            reasons.push(
              'Squad needs this position'
            );
          } else if (
            positions[position] < 2
          ) {
            score += 20;
            reasons.push(
              'Squad depth is low'
            );
          }

          if (overall >= 75) {
            score += 15;
            reasons.push(
              'Strong overall rating'
            );
          }

          if (
            safeNumber(
              player.age,
              30
            ) <= 23
          ) {
            score += 12;
            reasons.push(
              'High development potential'
            );
          }

          const status = normalize(
            player.transferStatus
          );

          if (
            status.includes('listed') ||
            status.includes('available')
          ) {
            score += 10;
            reasons.push(
              'Available on the market'
            );
          }

          return {
            player,
            score: Math.round(score),
            reasons: reasons.slice(0, 3),
          };
        })
        .sort(
          (a, b) => b.score - a.score
        )
        .slice(0, MAX_SUGGESTIONS);
    }, [
      players,
      currentClubPlayers,
      currentClubId,
      careerData,
      currentClub,
    ]);

  /* =======================================================
     ACCEPT BID
  ======================================================= */

  async function acceptBid(bid) {
    if (
      !bid?.playerId ||
      !currentClubId
    ) {
      return;
    }

    const player = playerMap[bid.playerId];

    if (!player) {
      toast.error(
        'Player no longer exists'
      );
      return;
    }

    const confirmed = window.confirm(
      `Accept €${money(bid.offerAmount)} offer for ${playerName(player)}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);

      const gameDate =
        currentGameDate || new Date();

      const acceptedOffer = {
        ...bid,
        status: 'accepted',
        acceptedAt: gameDate.toISOString(),
        joiningDate: addGameDays(
          gameDate,
          JOIN_DELAY_DAYS
        ),
      };

      const existingOffers = Array.isArray(
        player.transferOffers
      )
        ? player.transferOffers
        : [];

      const updatedOffers = existingOffers.map(
        (offer, index) =>
          index === bid.offerIndex
            ? acceptedOffer
            : offer
      );

      await updatePlayer(player.id, {
        transferOffers: updatedOffers,
        latestOffer: acceptedOffer,
        transferStatus: 'accepted',
        pendingTransfer: {
          ...acceptedOffer,
          fromClubId: currentClubId,
          fromClubName:
            currentClub?.name || '',
          toClubId: bid.buyerClubId,
          toClubName: bid.buyerClubName,
          acceptedAt: gameDate.toISOString(),
          joiningDate: addGameDays(
            gameDate,
            JOIN_DELAY_DAYS
          ),
          status: 'joining',
        },
      });

      setSelectedBid(null);
      setShowBidModal(false);
      toast.success(
        'Transfer accepted. Player will join the new club according to the game calendar.'
      );
    } catch (error) {
      console.error(error);
      toast.error(
        'Could not accept transfer'
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     REJECT BID
  ======================================================= */

  async function rejectBid(bid) {
    if (!bid?.playerId) {
      return;
    }

    const player = playerMap[bid.playerId];

    if (!player) {
      return;
    }

    const confirmed = window.confirm(
      `Reject the offer for ${playerName(player)}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);

      const gameDate =
        currentGameDate || new Date();

      const offers = Array.isArray(
        player.transferOffers
      )
        ? player.transferOffers
        : [];

      const updatedOffers = offers.map(
        (offer, index) =>
          index === bid.offerIndex
            ? {
                ...offer,
                status: 'rejected',
                rejectedAt:
                  gameDate.toISOString(),
              }
            : offer
      );

      await updatePlayer(player.id, {
        transferOffers: updatedOffers,
        latestOffer: {
          ...bid,
          status: 'rejected',
          rejectedAt: gameDate.toISOString(),
        },
        transferStatus: 'available',
      });

      setSelectedBid(null);
      setShowBidModal(false);
      toast.success('Offer rejected');
    } catch (error) {
      console.error(error);
      toast.error(
        'Could not reject offer'
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     ACCEPT COUNTER OFFER
  ======================================================= */

  async function acceptCounterOffer(bid) {
    if (
      !bid?.playerId ||
      !bid.counterOffer ||
      !currentClubId
    ) {
      return;
    }

    const player = playerMap[bid.playerId];

    if (!player) {
      toast.error(
        'Player no longer exists'
      );
      return;
    }

    const counterAmount = safeNumber(
      bid.counterOffer,
      0
    );

    const budget = safeNumber(
      careerData?.transferBudget,
      currentClub?.transferBudget || 0
    );

    if (counterAmount > budget) {
      toast.error(
        'You cannot afford this counter offer.'
      );
      return;
    }

    try {
      setSaving(true);

      const gameDate =
        currentGameDate || new Date();

      const existingOffers = Array.isArray(
        player.transferOffers
      )
        ? player.transferOffers
        : [];

      const updatedOffers = existingOffers.map(
        (offer, index) =>
          index === bid.offerIndex
            ? {
                ...offer,
                offerAmount: counterAmount,
                status: 'accepted',
                acceptedAt:
                  gameDate.toISOString(),
                joiningDate: addGameDays(
                  gameDate,
                  JOIN_DELAY_DAYS
                ),
              }
            : offer
      );

      const acceptedOffer =
        updatedOffers[bid.offerIndex];

      await updatePlayer(player.id, {
        transferOffers: updatedOffers,
        latestOffer: acceptedOffer,
        transferStatus: 'accepted',
        pendingTransfer: {
          ...acceptedOffer,
          fromClubId: currentClubId,
          fromClubName:
            currentClub?.name || '',
          toClubId: bid.buyerClubId,
          toClubName: bid.buyerClubName,
          acceptedAt: gameDate.toISOString(),
          joiningDate: addGameDays(
            gameDate,
            JOIN_DELAY_DAYS
          ),
          status: 'joining',
        },
      });

      setSelectedBid(null);
      setShowBidModal(false);
      toast.success(
        `Counter offer accepted: €${money(counterAmount)}`
      );
    } catch (error) {
      console.error(error);
      toast.error(
        'Could not accept counter offer'
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     OPEN CONTRACT
  ======================================================= */

  function openContract(player) {
    setContractPlayer(player);

    setContractWage(
      String(
        safeNumber(
          player?.wage ||
            player?.salary,
          0
        )
      )
    );

    setContractBonus('');
    setContractYears('3');
    setShowContractModal(true);
  }

  /* =======================================================
     MAKE CONTRACT OFFER
  ======================================================= */

  async function makeContractOffer() {
    if (
      !contractPlayer ||
      !currentClubId
    ) {
      return;
    }

    const wage = safeNumber(
      contractWage,
      0
    );

    const bonus = safeNumber(
      contractBonus,
      0
    );

    const years = safeNumber(
      contractYears,
      3
    );

    if (wage <= 0) {
      toast.error(
        'Enter a valid weekly wage'
      );
      return;
    }

    if (years <= 0) {
      toast.error(
        'Contract duration is invalid'
      );
      return;
    }

    try {
      setContractLoading(true);

      const gameDate =
        currentGameDate || new Date();

      const contract = {
        id: `${currentClubId}-${contractPlayer.id}-${Date.now()}`,
        clubId: currentClubId,
        clubName: currentClub?.name || '',
        playerId: contractPlayer.id,
        playerName: playerName(
          contractPlayer
        ),
        weeklyWage: wage,
        signingBonus: bonus,
        years,
        status: 'contract-offered',
        negotiationRound: 1,
        secondChanceUsed: false,
        createdAt: gameDate.toISOString(),
        responseDeadline: addGameDays(
          gameDate,
          CONTRACT_WAIT_DAYS
        ),
        createdBy: user?.uid || 'user',
      };

      await updatePlayer(
        contractPlayer.id,
        {
          contractOffers: arrayUnion(
            contract
          ),
          latestContractOffer: contract,
          transferStatus:
            'contract-offered',
        }
      );

      setShowContractModal(false);
      setContractPlayer(null);
      toast.success(
        'Contract offer sent.'
      );
    } catch (error) {
      console.error(error);
      toast.error(
        'Could not send contract offer'
      );
    } finally {
      setContractLoading(false);
    }
  }

  /* =======================================================
     SECOND NEGOTIATION
  ======================================================= */

  async function secondNegotiation(
    contract
  ) {
    if (
      !contract ||
      !contract.playerId ||
      contract.secondChanceUsed
    ) {
      return;
    }

    const player = playerMap[
      contract.playerId
    ];

    if (!player) {
      toast.error(
        'Player no longer exists'
      );
      return;
    }

    try {
      setSaving(true);

      const currentWage = safeNumber(
        contract.weeklyWage,
        0
      );

      const improvedWage = Math.round(
        currentWage * 1.15
      );

      const gameDate =
        currentGameDate || new Date();

      const offers = Array.isArray(
        player.contractOffers
      )
        ? player.contractOffers
        : [];

      const updatedOffers = offers.map(
        (offer) => {
          if (offer.id !== contract.id) {
            return offer;
          }

          return {
            ...offer,
            weeklyWage: improvedWage,
            negotiationRound:
              safeNumber(
                offer.negotiationRound,
                1
              ) + 1,
            secondChanceUsed: true,
            status: 'contract-offered',
            createdAt: gameDate.toISOString(),
            responseDeadline: addGameDays(
              gameDate,
              CONTRACT_WAIT_DAYS
            ),
          };
        }
      );

      const latest = updatedOffers.find(
        (offer) =>
          offer.id === contract.id
      );

      await updatePlayer(player.id, {
        contractOffers: updatedOffers,
        latestContractOffer: latest,
        transferStatus:
          'contract-offered',
      });

      toast.success(
        `Second negotiation sent with €${money(improvedWage)} weekly wage.`
      );
    } catch (error) {
      console.error(error);
      toast.error(
        'Could not start second negotiation'
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    isLoading
  ) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />

        <p>
          Loading transfer centre...
        </p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  /* =======================================================
     NO CLUB
  ======================================================= */

  if (!currentClubId) {
    return (
      <>
        <Head>
          <title>Transfer Centre</title>
        </Head>

        <main className={styles.emptyPage}>
          <div className={styles.emptyIcon}>
            🔄
          </div>

          <h1>No Club Assigned</h1>

          <p>
            You need to manage a club before
            negotiating transfers.
          </p>

          <button
            type="button"
            onClick={() =>
              router.push('/club')
            }
          >
            Choose Club
          </button>
        </main>
      </>
    );
  }

  /* =======================================================
     BUDGETS
  ======================================================= */

  const transferBudget =
    safeNumber(
      careerData?.transferBudget,
      currentClub?.transferBudget || 0
    );

  const wageBudget =
    safeNumber(
      careerData?.wageBudget,
      currentClub?.wageBudget || 0
    );

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Transfer Centre |{' '}
          {currentClub?.name ||
            'Club'}
        </title>

        <meta
          name="description"
          content="Manage transfer bids, AI negotiations, contracts, incoming offers and General Manager recommendations."
        />
      </Head>

      <main className={styles.page}>
        {/* =================================================
            HEADER
        ================================================= */}

        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.clubLogo}>
              {currentClub?.logo ? (
                <img
                  src={currentClub.logo}
                  alt=""
                />
              ) : (
                '⚽'
              )}
            </div>

            <div>
              <span
                className={styles.eyebrow}
              >
                FOOTBALL OPERATIONS
              </span>

              <h1>Transfer Centre</h1>

              <p>
                {currentClub?.name}
              </p>

              {currentGameDate && (
                <small>
                  Game date:{' '}
                  {formatDate(
                    currentGameDate
                  )}
                </small>
              )}
            </div>
          </div>

          <div className={styles.budgetPanel}>
            <div>
              <span>
                TRANSFER BUDGET
              </span>

              <strong>
                €{money(transferBudget)}
              </strong>
            </div>

            <div>
              <span>
                WAGE BUDGET
              </span>

              <strong>
                €{money(wageBudget)}
              </strong>
            </div>
          </div>
        </header>

        {/* =================================================
            SUMMARY
        ================================================= */}

        <section className={styles.summaryGrid}>
          <article
            className={styles.summaryCard}
          >
            <span>📥</span>

            <div>
              <small>INCOMING</small>

              <strong>
                {pendingIncoming}
              </strong>

              <p>
                Offers awaiting decision
              </p>
            </div>
          </article>

          <article
            className={styles.summaryCard}
          >
            <span>📤</span>

            <div>
              <small>OUTGOING</small>

              <strong>
                {pendingOutgoing}
              </strong>

              <p>
                Your active bids
              </p>
            </div>
          </article>

          <article
            className={styles.summaryCard}
          >
            <span>✍️</span>

            <div>
              <small>CONTRACTS</small>

              <strong>
                {contractWaiting}
              </strong>

              <p>
                Players considering offers
              </p>
            </div>
          </article>

          <article
            className={styles.summaryCard}
          >
            <span>✅</span>

            <div>
              <small>DEALS</small>

              <strong>
                {acceptedDeals}
              </strong>

              <p>
                Accepted transfers
              </p>
            </div>
          </article>

          <article
            className={styles.summaryCard}
          >
            <span>⏳</span>

            <div>
              <small>JOINING</small>

              <strong>
                {joiningCount}
              </strong>

              <p>
                Players arriving soon
              </p>
            </div>
          </article>
        </section>

        {/* =================================================
            GM ALERT
        ================================================= */}

        {suggestions.length > 0 && (
          <section className={styles.gmBanner}>
            <div className={styles.gmAvatar}>
              GM
            </div>

            <div>
              <span>
                GENERAL MANAGER
              </span>

              <strong>
                I have identified potential
                recruitment targets.
              </strong>

              <p>
                Based on squad needs, budget,
                rating, age and market
                availability.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setActiveTab(
                  'suggestions'
                )
              }
            >
              View Recommendations
            </button>
          </section>
        )}

        {/* =================================================
            NAV
        ================================================= */}

        <nav className={styles.tabs}>
          <button
            className={
              activeTab === 'incoming'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'incoming'
              )
            }
          >
            📥 Incoming Bids
            {pendingIncoming > 0 && (
              <b>{pendingIncoming}</b>
            )}
          </button>

          <button
            className={
              activeTab === 'outgoing'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'outgoing'
              )
            }
          >
            📤 My Bids
          </button>

          <button
            className={
              activeTab === 'joining'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab('joining')
            }
          >
            ⏳ Joining Club
            {joiningCount > 0 && (
              <b>{joiningCount}</b>
            )}
          </button>

          <button
            className={
              activeTab === 'contracts'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'contracts'
              )
            }
          >
            ✍️ Contracts
          </button>

          <button
            className={
              activeTab === 'suggestions'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'suggestions'
              )
            }
          >
            🧠 GM Suggestions
          </button>
        </nav>

        {/* =================================================
            BID LIST
        ================================================= */}

        {(activeTab === 'incoming' ||
          activeTab === 'outgoing') && (
          <section
            className={styles.contentCard}
          >
            <div
              className={styles.contentHeader}
            >
              <div>
                <span>
                  TRANSFER MARKET
                </span>

                <h2>
                  {activeTab ===
                  'incoming'
                    ? 'Offers for Your Players'
                    : 'Your Transfer Bids'}
                </h2>
              </div>

              <div
                className={styles.headerTools}
              >
                <div
                  className={styles.search}
                >
                  🔎
                  <input
                    value={search}
                    onChange={(event) =>
                      setSearch(
                        event.target
                          .value
                      )
                    }
                    placeholder="Search player or club..."
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target
                        .value
                    )
                  }
                >
                  <option value="all">
                    All Status
                  </option>

                  <option value="pending">
                    Pending
                  </option>

                  <option value="accepted">
                    Accepted
                  </option>

                  <option value="rejected">
                    Rejected
                  </option>

                  <option value="negotiation">
                    Negotiation
                  </option>
                </select>
              </div>
            </div>

            <div
              className={styles.tableWrapper}
            >
              <table
                className={
                  styles.transferTable
                }
              >
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Club</th>
                    <th>Offer</th>
                    <th>Asking</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleBids.length > 0 ? (
                    visibleBids.map(
                      (bid) => {
                        const player =
                          bid.player;

                        const status =
                          offerStatus(
                            bid
                          );

                        const remaining =
                          gameDaysRemaining(
                            bid.responseDeadline,
                            currentGameDate
                          );

                        return (
                          <tr
                            key={
                              bid.id
                            }
                          >
                            <td>
                              <button
                                type="button"
                                className={
                                  styles.playerButton
                                }
                                onClick={() =>
                                  router.push(
                                    `/player/${player.id}`
                                  )
                                }
                              >
                                <div
                                  className={
                                    styles.avatar
                                  }
                                >
                                  {player?.photo ? (
                                    <img
                                      src={
                                        player.photo
                                      }
                                      alt=""
                                    />
                                  ) : (
                                    playerName(
                                      player
                                    )
                                      .charAt(
                                        0
                                      )
                                      .toUpperCase()
                                  )}
                                </div>

                                <span>
                                  <strong>
                                    {playerName(
                                      player
                                    )}
                                  </strong>

                                  <small>
                                    {playerPosition(
                                      player
                                    )}{' '}
                                    • OVR{' '}
                                    {playerOverall(
                                      player
                                    )}
                                  </small>
                                </span>
                              </button>
                            </td>

                            <td>
                              <span>
                                {
                                  bid.buyerClubName
                                }
                              </span>
                            </td>

                            <td>
                              <strong
                                className={
                                  styles.offerAmount
                                }
                              >
                                €
                                {money(
                                  bid.offerAmount
                                )}
                              </strong>
                            </td>

                            <td>
                              €
                              {money(
                                bid.askingPrice ||
                                  askingPrice(
                                    player
                                  )
                              )}
                            </td>

                            <td>
                              <span
                                className={`${styles.status} ${styles[statusClass(status)]}`}
                              >
                                {statusText(
                                  status
                                )}
                              </span>
                            </td>

                            <td>
                              <small
                                className={
                                  styles.date
                                }
                              >
                                {formatDate(
                                  bid.createdAt
                                )}

                                {remaining !==
                                  null && (
                                  <>
                                    {' '}
                                    •{' '}
                                    {remaining >
                                    0
                                      ? `${remaining} game days`
                                      : 'Due'}
                                  </>
                                )}
                              </small>
                            </td>

                            <td>
                              <div
                                className={
                                  styles.actions
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedBid(
                                      bid
                                    );

                                    setShowBidModal(
                                      true
                                    );
                                  }}
                                >
                                  View
                                </button>

                                {activeTab ===
                                  'incoming' &&
                                  status ===
                                    'pending' && (
                                    <>
                                      <button
                                        type="button"
                                        className={
                                          styles.acceptButton
                                        }
                                        disabled={
                                          saving
                                        }
                                        onClick={() =>
                                          acceptBid(
                                            bid
                                          )
                                        }
                                      >
                                        Accept
                                      </button>

                                      <button
                                        type="button"
                                        className={
                                          styles.rejectButton
                                        }
                                        disabled={
                                          saving
                                        }
                                        onClick={() =>
                                          rejectBid(
                                            bid
                                          )
                                        }
                                      >
                                        Reject
                                      </button>
                                    </>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      }
                    )
                  ) : (
                    <tr>
                      <td
                        colSpan="7"
                        className={
                          styles.emptyTable
                        }
                      >
                        <div>
                          <span>
                            📭
                          </span>

                          <strong>
                            No transfer activity
                          </strong>

                          <p>
                            There are no offers
                            matching your filters.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* =================================================
            JOINING PLAYERS
        ================================================= */}

        {activeTab === 'joining' && (
          <section
            className={styles.contentCard}
          >
            <div
              className={styles.contentHeader}
            >
              <div>
                <span>
                  PENDING ARRIVALS
                </span>

                <h2>
                  Players Joining Your Club
                </h2>

                <p>
                  These players have
                  accepted transfers and will
                  join your club according to
                  the game calendar.
                </p>
              </div>
            </div>

            {joiningPlayers.length > 0 ? (
              <div
                className={
                  styles.joiningList
                }
              >
                {joiningPlayers.map(
                  (player) => {
                    const pending =
                      player.pendingTransfer;

                    const remaining =
                      gameDaysRemaining(
                        pending.joiningDate,
                        currentGameDate
                      );

                    return (
                      <article
                        key={player.id}
                        className={
                          styles.joiningCard
                        }
                      >
                        <div
                          className={
                            styles.avatarLarge
                          }
                        >
                          {player.photo ? (
                            <img
                              src={
                                player.photo
                              }
                              alt=""
                            />
                          ) : (
                            playerName(
                              player
                            )
                              .charAt(
                                0
                              )
                              .toUpperCase()
                          )}
                        </div>

                        <div
                          className={
                            styles.joiningInfo
                          }
                        >
                          <span>
                            {playerPosition(
                              player
                            )}
                          </span>

                          <h3>
                            {playerName(
                              player
                            )}
                          </h3>

                          <p>
                            From:{' '}
                            {pending.fromClubName ||
                              'Unknown'}
                          </p>

                          <p>
                            Fee: €
                            {money(
                              pending.offerAmount
                            )}
                          </p>
                        </div>

                        <div
                          className={
                            styles.joiningDate
                          }
                        >
                          <span>
                            JOINING DATE
                          </span>

                          <strong>
                            {formatDate(
                              pending.joiningDate
                            )}
                          </strong>

                          {remaining !== null && (
                            <small>
                              {remaining > 0
                                ? `${remaining} game days remaining`
                                : 'Joining today or soon'}
                            </small>
                          )}

                          <button
                            type="button"
                            className={
                              styles.secondaryButton
                            }
                            onClick={() =>
                              openContract(
                                player
                              )
                            }
                          >
                            Offer Contract
                          </button>
                        </div>
                      </article>
                    );
                  }
                )}
              </div>
            ) : (
              <div
                className={styles.emptyState}
              >
                <span>⏳</span>

                <h3>
                  No players joining
                </h3>

                <p>
                  When a transfer is accepted,
                  the player will appear here
                  while waiting to join your
                  club.
                </p>
              </div>
            )}
          </section>
        )}

        {/* =================================================
            CONTRACTS
        ================================================= */}

        {activeTab === 'contracts' && (
          <section
            className={styles.contentCard}
          >
            <div
              className={styles.contentHeader}
            >
              <div>
                <span>
                  PLAYER NEGOTIATIONS
                </span>

                <h2>Contract Offers</h2>
              </div>
            </div>

            <div
              className={styles.contractGrid}
            >
              {contractOffers.length > 0 ? (
                contractOffers.map(
                  (contract) => {
                    const remaining =
                      gameDaysRemaining(
                        contract.responseDeadline,
                        currentGameDate
                      );

                    const player =
                      contract.player;

                    const status =
                      offerStatus(
                        contract
                      );

                    return (
                      <article
                        key={
                          contract.id
                        }
                        className={
                          styles.contractCard
                        }
                      >
                        <div
                          className={
                            styles.contractTop
                          }
                        >
                          <div
                            className={
                              styles.avatarLarge
                            }
                          >
                            {player?.photo ? (
                              <img
                                src={
                                  player.photo
                                }
                                alt=""
                              />
                            ) : (
                              playerName(
                                player
                              )
                                .charAt(
                                  0
                                )
                                .toUpperCase()
                            )}
                          </div>

                          <div>
                            <span>
                              {playerPosition(
                                player
                              )}
                            </span>

                            <h3>
                              {playerName(
                                player
                              )}
                            </h3>

                            <p>
                              {clubName(
                                player
                              )}
                            </p>
                          </div>
                        </div>

                        <div
                          className={
                            styles.contractStats
                          }
                        >
                          <div>
                            <small>
                              WEEKLY WAGE
                            </small>

                            <strong>
                              €
                              {money(
                                contract.weeklyWage
                              )}
                            </strong>
                          </div>

                          <div>
                            <small>
                              BONUS
                            </small>

                            <strong>
                              €
                              {money(
                                contract.signingBonus
                              )}
                            </strong>
                          </div>

                          <div>
                            <small>
                              TERM
                            </small>

                            <strong>
                              {contract.years ||
                                0}{' '}
                              yrs
                            </strong>
                          </div>
                        </div>

                        <div
                          className={
                            styles.contractStatus
                          }
                        >
                          <span
                            className={`${styles.status} ${styles[statusClass(status)]}`}
                          >
                            {statusText(
                              status
                            )}
                          </span>

                          {remaining !== null && (
                            <span>
                              {remaining > 0
                                ? `${remaining} game days remaining`
                                : 'Response deadline reached'}
                            </span>
                          )}
                        </div>

                        <div
                          className={
                            styles.contractActions
                          }
                        >
                          {status ===
                            'contract-offered' && (
                            <button
                              type="button"
                              onClick={() =>
                                secondNegotiation(
                                  contract
                                )
                              }
                              disabled={
                                contract.secondChanceUsed ||
                                saving
                              }
                            >
                              {contract.secondChanceUsed
                                ? 'Second Chance Used'
                                : 'Second Negotiation'}
                            </button>
                          )}

                          <button
                            type="button"
                            className={
                              styles.secondaryButton
                            }
                            onClick={() =>
                              router.push(
                                `/player/${player?.id}`
                              )
                            }
                          >
                            View Player
                          </button>
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
                  <span>✍️</span>

                  <h3>
                    No active contracts
                  </h3>

                  <p>
                    Contract negotiations will
                    appear here.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* =================================================
            SUGGESTIONS
        ================================================= */}

        {activeTab === 'suggestions' && (
          <section
            className={styles.contentCard}
          >
            <div
              className={styles.contentHeader}
            >
              <div>
                <span>
                  MANAGEMENT INTELLIGENCE
                </span>

                <h2>
                  General Manager
                  Recommendations
                </h2>

                <p>
                  Recruitment targets based on
                  squad and budget.
                </p>
              </div>

              <div
                className={styles.gmBadge}
              >
                🧠 GM
              </div>
            </div>

            <div
              className={
                styles.suggestionGrid
              }
            >
              {suggestions.map(
                ({
                  player,
                  score,
                  reasons,
                }) => (
                  <article
                    key={player.id}
                    className={
                      styles.suggestionCard
                    }
                  >
                    <div
                      className={
                        styles.suggestionHeader
                      }
                    >
                      <div
                        className={
                          styles.avatarLarge
                        }
                      >
                        {player.photo ? (
                          <img
                            src={
                              player.photo
                            }
                            alt=""
                          />
                        ) : (
                          playerName(
                            player
                          )
                            .charAt(
                              0
                            )
                            .toUpperCase()
                        )}
                      </div>

                      <div>
                        <span>
                          GM SCORE
                        </span>

                        <strong>
                          {score}
                        </strong>
                      </div>
                    </div>

                    <h3>
                      {playerName(
                        player
                      )}
                    </h3>

                    <p>
                      {playerPosition(
                        player
                      )}{' '}
                      • OVR{' '}
                      {playerOverall(
                        player
                      )}
                    </p>

                    <div
                      className={
                        styles.suggestionInfo
                      }
                    >
                      <div>
                        <span>
                          VALUE
                        </span>

                        <strong>
                          €
                          {money(
                            playerValue(
                              player
                            )
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>
                          ASKING
                        </span>

                        <strong>
                          €
                          {money(
                            askingPrice(
                              player
                            )
                          )}
                        </strong>
                      </div>
                    </div>

                    <div
                      className={
                        styles.reasons
                      }
                    >
                      {reasons.map(
                        (
                          reason,
                          index
                        ) => (
                          <span
                            key={
                              index
                            }
                          >
                            ✓ {reason}
                          </span>
                        )
                      )}
                    </div>

                    <div
                      className={
                        styles.suggestionActions
                      }
                    >
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/player/${player.id}`
                          )
                        }
                      >
                        View Player
                      </button>

                      <button
                        type="button"
                        className={
                          styles.acceptButton
                        }
                        onClick={() =>
                          router.push(
                            `/players?player=${player.id}`
                          )
                        }
                      >
                        Start Negotiation
                      </button>
                    </div>
                  </article>
                )
              )}
            </div>
          </section>
        )}

        {/* =================================================
            BID MODAL
        ================================================= */}

        {showBidModal &&
          selectedBid && (
            <div
              className={
                styles.modalOverlay
              }
              onClick={() =>
                setShowBidModal(false)
              }
            >
              <div
                className={styles.modal}
                onClick={(event) =>
                  event.stopPropagation()
                }
              >
                <button
                  type="button"
                  className={styles.close}
                  onClick={() =>
                    setShowBidModal(false)
                  }
                >
                  ×
                </button>

                <span
                  className={styles.eyebrow}
                >
                  TRANSFER BID
                </span>

                <h2>
                  {playerName(
                    selectedBid.player
                  )}
                </h2>

                <p
                  className={
                    styles.modalSubtitle
                  }
                >
                  {selectedBid.buyerClubName}{' '}
                  has submitted a transfer
                  offer.
                </p>

                <div
                  className={
                    styles.bidSummary
                  }
                >
                  <div>
                    <span>OFFER</span>

                    <strong>
                      €
                      {money(
                        selectedBid.offerAmount
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      ASKING PRICE
                    </span>

                    <strong>
                      €
                      {money(
                        selectedBid.askingPrice ||
                          askingPrice(
                            selectedBid.player
                          )
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      MARKET VALUE
                    </span>

                    <strong>
                      €
                      {money(
                        playerValue(
                          selectedBid.player
                        )
                      )}
                    </strong>
                  </div>
                </div>

                <div
                  className={styles.bidMeta}
                >
                  <div>
                    <span>PLAYER</span>

                    <strong>
                      {playerPosition(
                        selectedBid.player
                      )}{' '}
                      • OVR{' '}
                      {playerOverall(
                        selectedBid.player
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      SUBMITTED
                    </span>

                    <strong>
                      {formatDateTime(
                        selectedBid.createdAt
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>STATUS</span>

                    <strong>
                      {statusText(
                        selectedBid.status
                      )}
                    </strong>
                  </div>

                  {selectedBid.responseDeadline &&
                    currentGameDate && (
                      <div>
                        <span>
                          GAME DEADLINE
                        </span>

                        <strong>
                          {formatDate(
                            selectedBid.responseDeadline
                          )}
                        </strong>
                      </div>
                    )}
                </div>

                {selectedBid.systemResponse &&
                  selectedBid.responseNote && (
                    <div
                      className={
                        styles.systemResponse
                      }
                    >
                      💬{' '}
                      {
                        selectedBid.responseNote
                      }
                    </div>
                  )}

                {selectedBid.counterOffer && (
                  <div
                    className={
                      styles.systemResponse
                    }
                  >
                    💰 AI counter offer:{' '}
                    <strong>
                      €
                      {money(
                        selectedBid.counterOffer
                      )}
                    </strong>
                  </div>
                )}

                <div
                  className={
                    styles.modalActions
                  }
                >
                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    onClick={() =>
                      router.push(
                        `/player/${selectedBid.playerId}`
                      )
                    }
                  >
                    View Player
                  </button>

                  {activeTab ===
                    'incoming' &&
                    offerStatus(
                      selectedBid
                    ) === 'pending' && (
                      <>
                        <button
                          type="button"
                          className={
                            styles.rejectButton
                          }
                          disabled={saving}
                          onClick={() =>
                            rejectBid(
                              selectedBid
                            )
                          }
                        >
                          Reject
                        </button>

                        <button
                          type="button"
                          className={
                            styles.acceptButton
                          }
                          disabled={saving}
                          onClick={() =>
                            acceptBid(
                              selectedBid
                            )
                          }
                        >
                          {saving
                            ? 'Processing...'
                            : 'Accept Bid'}
                        </button>
                      </>
                    )}

                  {activeTab ===
                    'outgoing' &&
                    selectedBid.counterOffer &&
                    selectedBid.status ===
                      'negotiation' && (
                      <button
                        type="button"
                        className={
                          styles.acceptButton
                        }
                        disabled={saving}
                        onClick={() =>
                          acceptCounterOffer(
                            selectedBid
                          )
                        }
                      >
                        Accept Counter €
                        {money(
                          selectedBid.counterOffer
                        )}
                      </button>
                    )}
                </div>
              </div>
            </div>
          )}

        {/* =================================================
            CONTRACT MODAL
        ================================================= */}

        {showContractModal &&
          contractPlayer && (
            <div
              className={
                styles.modalOverlay
              }
              onClick={() =>
                setShowContractModal(
                  false
                )
              }
            >
              <div
                className={styles.modal}
                onClick={(event) =>
                  event.stopPropagation()
                }
              >
                <button
                  type="button"
                  className={styles.close}
                  onClick={() =>
                    setShowContractModal(
                      false
                    )
                  }
                >
                  ×
                </button>

                <span
                  className={styles.eyebrow}
                >
                  CONTRACT NEGOTIATION
                </span>

                <h2>
                  {playerName(
                    contractPlayer
                  )}
                </h2>

                <p
                  className={
                    styles.modalSubtitle
                  }
                >
                  Offer the player a new
                  contract.
                </p>

                <div
                  className={
                    styles.contractForm
                  }
                >
                  <label>
                    Weekly Wage

                    <div
                      className={
                        styles.moneyInput
                      }
                    >
                      <span>€</span>

                      <input
                        type="number"
                        min="0"
                        value={
                          contractWage
                        }
                        onChange={(
                          event
                        ) =>
                          setContractWage(
                            event
                              .target
                              .value
                          )
                        }
                        placeholder="0"
                      />
                    </div>
                  </label>

                  <label>
                    Signing Bonus

                    <div
                      className={
                        styles.moneyInput
                      }
                    >
                      <span>€</span>

                      <input
                        type="number"
                        min="0"
                        value={
                          contractBonus
                        }
                        onChange={(
                          event
                        ) =>
                          setContractBonus(
                            event
                              .target
                              .value
                          )
                        }
                        placeholder="0"
                      />
                    </div>
                  </label>

                  <label>
                    Contract Length

                    <select
                      value={
                        contractYears
                      }
                      onChange={(
                        event
                      ) =>
                        setContractYears(
                          event
                            .target
                            .value
                        )
                      }
                    >
                      <option value="1">
                        1 Year
                      </option>

                      <option value="2">
                        2 Years
                      </option>

                      <option value="3">
                        3 Years
                      </option>

                      <option value="4">
                        4 Years
                      </option>

                      <option value="5">
                        5 Years
                      </option>
                    </select>
                  </label>
                </div>

                <div
                  className={
                    styles.contractNotice
                  }
                >
                  ⏱️ The player will have
                  approximately{' '}
                  <strong>
                    {CONTRACT_WAIT_DAYS}{' '}
                    game days
                  </strong>{' '}
                  to respond.
                </div>

                <button
                  type="button"
                  className={
                    styles.primaryButton
                  }
                  disabled={
                    contractLoading
                  }
                  onClick={
                    makeContractOffer
                  }
                >
                  {contractLoading
                    ? 'Sending...'
                    : 'Send Contract Offer'}
                </button>
              </div>
            </div>
          )}
      </main>
    </>
  );
}
