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
const MAX_SUGGESTIONS = 8;
const SYSTEM_RESPONSE_DAYS = 2;
const FIRESTORE_BATCH_SIZE = 450;

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
  return player?.position || player?.primaryPosition || player?.role || 'Unknown';
}

function playerOverall(player) {
  return safeNumber(player?.overall ?? player?.rating ?? player?.overallRating, 0);
}

function playerValue(player) {
  return safeNumber(player?.marketValue ?? player?.value ?? player?.askingPrice, 0);
}

function askingPrice(player) {
  return safeNumber(player?.askingPrice ?? player?.transferFee ?? playerValue(player), 0);
}

function clubId(player) {
  return player?.clubId || player?.currentClub || player?.teamId || null;
}

function clubName(player) {
  return player?.clubName || player?.currentClubName || player?.teamName || 'Free Agent';
}

function dateValue(value) {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value === 'object' && value.seconds) {
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

function addDays(date, days) {
  const base = dateValue(date) || new Date();
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function daysRemaining(value) {
  const date = dateValue(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function offerStatus(offer) {
  return normalize(offer?.status || 'pending');
}

function statusText(status) {
  switch (normalize(status)) {
    case 'accepted': return 'Accepted';
    case 'rejected': return 'Rejected';
    case 'pending': return 'Pending';
    case 'negotiation': return 'Negotiation';
    case 'contract-offered': return 'Contract Offered';
    case 'contract-accepted': return 'Contract Accepted';
    case 'joining': return 'Joining Club';
    case 'completed': return 'Completed';
    case 'expired': return 'Expired';
    default: return status || 'Pending';
  }
}

function statusClass(status) {
  const value = normalize(status);
  if (value === 'accepted' || value === 'contract-accepted' || value === 'completed') {
    return 'success';
  }
  if (value === 'rejected' || value === 'expired') {
    return 'danger';
  }
  if (value === 'negotiation' || value === 'contract-offered' || value === 'joining') {
    return 'warning';
  }
  return 'pending';
}

/* =========================================================
   SYSTEM NEGOTIATION LOGIC
========================================================= */

function systemNegotiateBid(offer, player, sellingClub) {
  const playerOvr = playerOverall(player);
  const playerVal = playerValue(player);
  const offerAmount = safeNumber(offer.offerAmount, 0);
  const askingPriceValue = safeNumber(offer.askingPrice || askingPrice(player), 0);

  // Calculate acceptance probability
  let acceptChance = 0.3;

  // Higher offer relative to asking price = higher chance
  if (askingPriceValue > 0) {
    const ratio = offerAmount / askingPriceValue;
    if (ratio >= 1.5) acceptChance += 0.4;
    else if (ratio >= 1.2) acceptChance += 0.3;
    else if (ratio >= 1.0) acceptChance += 0.2;
    else if (ratio >= 0.8) acceptChance += 0.1;
    else acceptChance -= 0.2;
  }

  // Higher player overall = lower chance to sell cheap
  if (playerOvr >= 85) acceptChance -= 0.15;
  else if (playerOvr >= 75) acceptChance -= 0.1;
  else if (playerOvr >= 65) acceptChance -= 0.05;

  // Player is transfer listed = higher chance
  const playerStatus = normalize(player.transferStatus || '');
  if (playerStatus.includes('listed') || playerStatus.includes('transfer')) {
    acceptChance += 0.25;
  }

  // Clamp
  acceptChance = Math.max(0.05, Math.min(0.95, acceptChance));

  const random = Math.random();
  const accepted = random < acceptChance;

  if (accepted) {
    return {
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      systemResponse: true,
      responseNote: `The selling club has accepted the €${money(offerAmount)} offer.`,
    };
  } else {
    // Check if counter offer should be made
    const counterChance = 0.3;
    if (Math.random() < counterChance && askingPriceValue > offerAmount) {
      const counterOffer = Math.round(askingPriceValue * 0.9);
      return {
        status: 'negotiation',
        counterOffer,
        systemResponse: true,
        responseNote: `The selling club rejected the offer but is willing to negotiate at €${money(counterOffer)}.`,
      };
    }

    return {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      systemResponse: true,
      responseNote: `The selling club has rejected the offer.`,
    };
  }
}

function systemNegotiateContract(offer, player, club) {
  const playerOvr = playerOverall(player);
  const wage = safeNumber(offer.weeklyWage, 0);
  const currentWage = safeNumber(player.wage || player.salary, 0);

  let acceptChance = 0.3;

  // Higher wage relative to current = higher chance
  if (currentWage > 0) {
    const ratio = wage / currentWage;
    if (ratio >= 2) acceptChance += 0.4;
    else if (ratio >= 1.5) acceptChance += 0.3;
    else if (ratio >= 1.2) acceptChance += 0.2;
    else if (ratio >= 1.0) acceptChance += 0.1;
    else acceptChance -= 0.3;
  }

  // Higher player overall = harder to sign
  if (playerOvr >= 85) acceptChance -= 0.15;
  else if (playerOvr >= 75) acceptChance -= 0.1;

  // Player wants more money for top clubs
  if (playerOvr >= 80) acceptChance -= 0.05;

  acceptChance = Math.max(0.05, Math.min(0.9, acceptChance));

  const accepted = Math.random() < acceptChance;

  if (accepted) {
    return {
      status: 'contract-accepted',
      acceptedAt: new Date().toISOString(),
      systemResponse: true,
      responseNote: `${playerName(player)} has accepted the contract offer.`,
    };
  } else {
    return {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      systemResponse: true,
      responseNote: `${playerName(player)} has rejected the contract offer.`,
    };
  }
}

/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [playersSnapshot, clubsSnapshot] = await Promise.all([
      getDocs(collection(db, 'players')),
      getDocs(collection(db, 'clubs')),
    ]);

    const players = playersSnapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));

    const clubs = clubsSnapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));

    return {
      props: {
        initialPlayers: JSON.parse(JSON.stringify(players)),
        initialClubs: JSON.parse(JSON.stringify(clubs)),
      },
    };
  } catch (error) {
    console.error('Transfer SSR error:', error);

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
  const router = useRouter();
  const { user, loading } = useAuth();

  const [players, setPlayers] = useState(initialPlayers);
  const [clubs, setClubs] = useState(initialClubs);
  const [careerData, setCareerData] = useState(null);
  const [currentClub, setCurrentClub] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('incoming');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedBid, setSelectedBid] = useState(null);
  const [showBidModal, setShowBidModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractPlayer, setContractPlayer] = useState(null);
  const [contractWage, setContractWage] = useState('');
  const [contractBonus, setContractBonus] = useState('');
  const [contractYears, setContractYears] = useState('3');
  const [contractLoading, setContractLoading] = useState(false);
  const [isProcessingSystem, setIsProcessingSystem] = useState(false);

  const processedRef = useRef(new Set());

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      loadCareer();
    }
  }, [user, loading, router]);

  /* =======================================================
     LOAD CAREER
  ======================================================= */

  async function loadCareer() {
    try {
      setIsLoading(true);
      const userRef = doc(db, 'users', user.uid);
      const snapshot = await getDoc(userRef);

      if (!snapshot.exists()) {
        setCareerData({});
        return;
      }

      const data = snapshot.data();
      const career = data.careerData || {};
      setCareerData(career);

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
      console.error(error);
      toast.error('Could not load transfer centre');
    } finally {
      setIsLoading(false);
    }
  }

  /* =======================================================
     REAL-TIME PLAYERS
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(db, 'players'),
      (snapshot) => {
        const playerList = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }));
        setPlayers(playerList);
      },
      (error) => {
        console.error('Players realtime error:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     SYSTEM PROCESSING
  ======================================================= */

  const processSystemResponses = useCallback(async () => {
    if (!user || !currentClub || isProcessingSystem) return;

    try {
      setIsProcessingSystem(true);

      const today = new Date();
      const batch = writeBatch(db);
      let updateCount = 0;

      // Process all pending bids for players at clubs WITHOUT users
      players.forEach((player) => {
        const sellerClubId = clubId(player);

        // Skip if seller is current club (user's club)
        if (sellerClubId === currentClub.id) return;

        // Check if seller club has a managerId (meaning it has a user)
        const sellerClub = clubs.find((club) => club.id === sellerClubId);
        if (sellerClub?.managerId) return; // Has a user - user will respond

        const offers = Array.isArray(player.transferOffers) ? player.transferOffers : [];

        offers.forEach((offer, index) => {
          if (offerStatus(offer) !== 'pending') return;

          const offerDate = dateValue(offer.createdAt);
          if (!offerDate) return;

          const daysSince = Math.ceil((today.getTime() - offerDate.getTime()) / (1000 * 60 * 60 * 24));

          if (daysSince < SYSTEM_RESPONSE_DAYS) return;

          const processKey = `${player.id}-${index}-${offer.id || 'no-id'}`;
          if (processedRef.current.has(processKey)) return;

          processedRef.current.add(processKey);

          // System negotiates the bid
          const response = systemNegotiateBid(offer, player, sellerClub);

          const updatedOffers = [...offers];
          updatedOffers[index] = {
            ...offer,
            ...response,
          };

          const playerRef = doc(db, 'players', player.id);
          batch.update(playerRef, {
            transferOffers: updatedOffers,
            latestOffer: updatedOffers[index],
            transferStatus: response.status === 'accepted' ? 'accepted' : response.status,
            updatedAt: serverTimestamp(),
          });

          updateCount++;

          if (response.status === 'accepted') {
            // Set pending transfer for the player to join the buying club
            batch.update(playerRef, {
              pendingTransfer: {
                ...updatedOffers[index],
                fromClubId: sellerClubId,
                toClubId: offer.buyerClubId,
                joiningDate: addDays(new Date(), JOIN_DELAY_DAYS),
                status: 'joining',
              },
            });
          }
        });
      });

      if (updateCount > 0) {
        await batch.commit();
        toast.success(`System processed ${updateCount} transfer bids`);
      }
    } catch (error) {
      console.error('System processing error:', error);
    } finally {
      setIsProcessingSystem(false);
    }
  }, [user, currentClub, players, clubs, isProcessingSystem]);

  /* =======================================================
     SYSTEM CONTRACT RESPONSES
  ======================================================= */

  const processSystemContractResponses = useCallback(async () => {
    if (!user || !currentClub || isProcessingSystem) return;

    try {
      setIsProcessingSystem(true);

      const today = new Date();
      const batch = writeBatch(db);
      let updateCount = 0;

      players.forEach((player) => {
        const offers = Array.isArray(player.contractOffers) ? player.contractOffers : [];

        offers.forEach((offer, index) => {
          if (offerStatus(offer) !== 'contract-offered') return;

          const offerDate = dateValue(offer.createdAt);
          if (!offerDate) return;

          const daysSince = Math.ceil((today.getTime() - offerDate.getTime()) / (1000 * 60 * 60 * 24));

          if (daysSince < SYSTEM_RESPONSE_DAYS) return;

          const processKey = `${player.id}-contract-${index}-${offer.id || 'no-id'}`;
          if (processedRef.current.has(processKey)) return;

          processedRef.current.add(processKey);

          const response = systemNegotiateContract(offer, player, currentClub);

          const updatedOffers = [...offers];
          updatedOffers[index] = {
            ...offer,
            ...response,
          };

          const playerRef = doc(db, 'players', player.id);
          batch.update(playerRef, {
            contractOffers: updatedOffers,
            latestContractOffer: updatedOffers[index],
            updatedAt: serverTimestamp(),
          });

          updateCount++;
        });
      });

      if (updateCount > 0) {
        await batch.commit();
        toast.success(`System processed ${updateCount} contract offers`);
      }
    } catch (error) {
      console.error('System contract processing error:', error);
    } finally {
      setIsProcessingSystem(false);
    }
  }, [user, currentClub, players, isProcessingSystem]);

  /* =======================================================
     SYSTEM AI TRANSFER MARKET ACTIVITY
  ======================================================= */

  const processSystemAITransfers = useCallback(async () => {
    if (!user || !currentClub || isProcessingSystem) return;

    try {
      setIsProcessingSystem(true);

      const today = new Date();
      const gameDate = dateValue(careerData?.currentDate) || today;

      // Check if transfer window is open
      const month = gameDate.getMonth();
      const isSummerWindow = month >= 5 && month <= 7; // June-August
      const isWinterWindow = month === 0; // January

      if (!isSummerWindow && !isWinterWindow) return;

      const batch = writeBatch(db);
      let transferCount = 0;

      // AI clubs buy available players
      const aiClubs = clubs.filter((club) => !club.managerId && club.id !== currentClub.id);

      aiClubs.forEach((aiClub) => {
        if (transferCount >= 10) return; // Limit to 10 AI transfers per processing cycle

        const clubBudget = safeNumber(aiClub.transferBudget, 0);
        if (clubBudget <= 0) return;

        // Find available players not at this club
        const availablePlayers = players.filter((player) => {
          const playerClubId = clubId(player);
          if (!playerClubId || playerClubId === aiClub.id) return false;

          const status = normalize(player.transferStatus || '');
          return (
            status.includes('listed') ||
            status.includes('available') ||
            status.includes('transfer')
          );
        });

        if (availablePlayers.length === 0) return;

        // Pick a random affordable player
        const affordablePlayers = availablePlayers.filter(
          (player) => playerValue(player) <= clubBudget
        );

        if (affordablePlayers.length === 0) return;

        const targetPlayer = affordablePlayers[Math.floor(Math.random() * affordablePlayers.length)];
        const offerAmount = Math.round(playerValue(targetPlayer) * (0.8 + Math.random() * 0.5));

        // Create AI bid
        const aiBid = {
          id: `ai-${aiClub.id}-${targetPlayer.id}-${Date.now()}`,
          buyerClubId: aiClub.id,
          buyerClubName: aiClub.name || aiClub.clubName,
          playerId: targetPlayer.id,
          playerName: playerName(targetPlayer),
          offerAmount,
          askingPrice: askingPrice(targetPlayer),
          type: 'transfer',
          status: 'pending',
          createdBy: 'system-ai',
          createdAt: new Date().toISOString(),
        };

        const playerRef = doc(db, 'players', targetPlayer.id);
        batch.update(playerRef, {
          transferOffers: arrayUnion(aiBid),
          latestOffer: aiBid,
          updatedAt: serverTimestamp(),
        });

        transferCount++;
      });

      if (transferCount > 0) {
        await batch.commit();
        toast.success(`AI clubs submitted ${transferCount} transfer bids`);
      }
    } catch (error) {
      console.error('System AI transfer error:', error);
    } finally {
      setIsProcessingSystem(false);
    }
  }, [user, currentClub, players, clubs, careerData, isProcessingSystem]);

  /* =======================================================
     RUN SYSTEM PROCESSING
  ======================================================= */

  useEffect(() => {
    if (!user || !currentClub) return;

    const processInterval = setInterval(() => {
      processSystemResponses();
      processSystemContractResponses();
      processSystemAITransfers();
    }, 60000); // Run every minute

    return () => clearInterval(processInterval);
  }, [user, currentClub, processSystemResponses, processSystemContractResponses, processSystemAITransfers]);

  /* =======================================================
     CLUB
  ======================================================= */

  const currentClubId = careerData?.currentClub || null;

  const currentClubPlayers = useMemo(() => {
    if (!currentClubId) return [];
    return players.filter((player) => clubId(player) === currentClubId);
  }, [players, currentClubId]);

  const playerMap = useMemo(() => {
    return players.reduce((map, player) => {
      map[player.id] = player;
      return map;
    }, {});
  }, [players]);

  const clubMap = useMemo(() => {
    return clubs.reduce((map, club) => {
      map[club.id] = club;
      return map;
    }, {});
  }, [clubs]);

  /* =======================================================
     INCOMING BIDS
  ======================================================= */

  const incomingBids = useMemo(() => {
    const result = [];

    currentClubPlayers.forEach((player) => {
      const offers = Array.isArray(player.transferOffers) ? player.transferOffers : [];

      offers.forEach((offer, index) => {
        if (!offer || offer.type === 'loan') return;

        const buyerClubId = offer.buyerClubId || offer.fromClubId || offer.clubId;

        if (buyerClubId === currentClubId) return;

        result.push({
          ...offer,
          player,
          playerId: player.id,
          offerIndex: index,
          id: offer.id || `${player.id}-${index}`,
          buyerClubName:
            offer.buyerClubName ||
            clubMap[buyerClubId]?.name ||
            'Unknown Club',
          buyerClubId,
        });
      });
    });

    return result.sort((a, b) => {
      const aDate = dateValue(a.createdAt)?.getTime() || 0;
      const bDate = dateValue(b.createdAt)?.getTime() || 0;
      return bDate - aDate;
    });
  }, [currentClubPlayers, currentClubId, clubMap]);

  /* =======================================================
     OUTGOING BIDS
  ======================================================= */

  const outgoingBids = useMemo(() => {
    const result = [];

    players.forEach((player) => {
      const offers = Array.isArray(player.transferOffers) ? player.transferOffers : [];

      offers.forEach((offer, index) => {
        if (!offer || offer.type === 'loan') return;
        if (offer.buyerClubId !== currentClubId) return;

        result.push({
          ...offer,
          player,
          playerId: player.id,
          offerIndex: index,
          id: offer.id || `${player.id}-${index}`,
        });
      });
    });

    return result.sort((a, b) => {
      const aDate = dateValue(a.createdAt)?.getTime() || 0;
      const bDate = dateValue(b.createdAt)?.getTime() || 0;
      return bDate - aDate;
    });
  }, [players, currentClubId]);

  /* =======================================================
     CONTRACT OFFERS
  ======================================================= */

  const contractOffers = useMemo(() => {
    const result = [];

    players.forEach((player) => {
      const offers = Array.isArray(player.contractOffers) ? player.contractOffers : [];

      offers.forEach((offer, index) => {
        if (offer.clubId !== currentClubId) return;

        result.push({
          ...offer,
          player,
          playerId: player.id,
          offerIndex: index,
          id: offer.id || `${player.id}-contract-${index}`,
        });
      });
    });

    return result;
  }, [players, currentClubId]);

  /* =======================================================
     FILTERED BIDS
  ======================================================= */

  const visibleBids = useMemo(() => {
    let source = activeTab === 'incoming' ? incomingBids : outgoingBids;
    const term = normalize(search);

    if (term) {
      source = source.filter((bid) => {
        return (
          normalize(playerName(bid.player)).includes(term) ||
          normalize(bid.buyerClubName).includes(term)
        );
      });
    }

    if (statusFilter !== 'all') {
      source = source.filter(
        (bid) => normalize(bid.status) === normalize(statusFilter)
      );
    }

    return source;
  }, [activeTab, incomingBids, outgoingBids, search, statusFilter]);

  /* =======================================================
     STATS
  ======================================================= */

  const pendingIncoming = incomingBids.filter(
    (bid) => offerStatus(bid) === 'pending'
  ).length;

  const pendingOutgoing = outgoingBids.filter(
    (bid) =>
      offerStatus(bid) === 'pending' ||
      offerStatus(bid) === 'negotiation'
  ).length;

  const acceptedDeals = [...incomingBids, ...outgoingBids].filter(
    (bid) => offerStatus(bid) === 'accepted'
  ).length;

  const contractWaiting = contractOffers.filter(
    (offer) =>
      offerStatus(offer) === 'contract-offered' ||
      offerStatus(offer) === 'contract-accepted'
  ).length;

  /* =======================================================
     SUGGESTIONS
  ======================================================= */

  const suggestions = useMemo(() => {
    const budget = safeNumber(
      careerData?.transferBudget,
      currentClub?.transferBudget || 0
    );

    const squad = currentClubPlayers;
    const positions = squad.reduce((map, player) => {
      const pos = normalize(playerPosition(player));
      if (!map[pos]) map[pos] = 0;
      map[pos]++;
      return map;
    }, {});

    return players
      .filter((player) => clubId(player) !== currentClubId)
      .map((player) => {
        const position = normalize(playerPosition(player));
        const overall = playerOverall(player);
        const value = playerValue(player);

        let score = overall * 2;
        const reasons = [];

        if (budget > 0 && value <= budget) {
          score += 30;
          reasons.push('Fits transfer budget');
        }

        if (positions[position] < 2) {
          score += 25;
          reasons.push('Squad needs this position');
        }

        if (overall >= 75) {
          score += 15;
          reasons.push('Strong overall rating');
        }

        if (safeNumber(player.age, 30) <= 23) {
          score += 12;
          reasons.push('High development potential');
        }

        const status = normalize(player.transferStatus);
        if (status.includes('listed') || status.includes('available')) {
          score += 10;
          reasons.push('Available on the market');
        }

        return {
          player,
          score: Math.round(score),
          reasons: reasons.slice(0, 3),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS);
  }, [players, currentClubPlayers, currentClubId, careerData, currentClub]);

  /* =======================================================
     UPDATE PLAYER
  ======================================================= */

  async function updatePlayer(playerId, data) {
    try {
      await updateDoc(doc(db, 'players', playerId), {
        ...data,
        updatedAt: serverTimestamp(),
      });

      setPlayers((previous) =>
        previous.map((player) =>
          player.id === playerId ? { ...player, ...data } : player
        )
      );

      return true;
    } catch (error) {
      console.error(error);
      toast.error('Could not update player');
      return false;
    }
  }

  /* =======================================================
     ACCEPT BID (User accepts incoming bid)
  ======================================================= */

  async function acceptBid(bid) {
    if (!bid?.playerId || !currentClubId) return;

    const player = playerMap[bid.playerId];
    if (!player) {
      toast.error('Player no longer exists');
      return;
    }

    const confirmed = window.confirm(
      `Accept €${money(bid.offerAmount)} offer for ${playerName(player)}?`
    );

    if (!confirmed) return;

    try {
      setSaving(true);

      const acceptedOffer = {
        ...bid,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      };

      const existingOffers = Array.isArray(player.transferOffers)
        ? player.transferOffers
        : [];

      const updatedOffers = existingOffers.map((offer, index) =>
        index === bid.offerIndex ? acceptedOffer : offer
      );

      await updatePlayer(player.id, {
        transferOffers: updatedOffers,
        latestOffer: acceptedOffer,
        transferStatus: 'accepted',
        pendingTransfer: {
          ...acceptedOffer,
          fromClubId: currentClubId,
          fromClubName: currentClub?.name || '',
          toClubId: bid.buyerClubId,
          toClubName: bid.buyerClubName,
          acceptedAt: new Date().toISOString(),
          joiningDate: addDays(new Date(), JOIN_DELAY_DAYS),
          status: 'joining',
        },
      });

      setSelectedBid(null);
      setShowBidModal(false);
      toast.success('Transfer accepted. Player will join the new club.');
    } catch (error) {
      console.error(error);
      toast.error('Could not accept transfer');
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     REJECT BID
  ======================================================= */

  async function rejectBid(bid) {
    if (!bid?.playerId) return;

    const player = playerMap[bid.playerId];
    if (!player) return;

    const confirmed = window.confirm(`Reject the offer for ${playerName(player)}?`);
    if (!confirmed) return;

    try {
      setSaving(true);

      const offers = Array.isArray(player.transferOffers) ? player.transferOffers : [];
      const updatedOffers = offers.map((offer, index) =>
        index === bid.offerIndex
          ? { ...offer, status: 'rejected', rejectedAt: new Date().toISOString() }
          : offer
      );

      await updatePlayer(player.id, {
        transferOffers: updatedOffers,
        latestOffer: { ...bid, status: 'rejected' },
        transferStatus: 'available',
      });

      setSelectedBid(null);
      setShowBidModal(false);
      toast.success('Offer rejected');
    } catch (error) {
      console.error(error);
      toast.error('Could not reject offer');
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     OPEN CONTRACT MODAL
  ======================================================= */

  function openContract(player) {
    setContractPlayer(player);
    setContractWage(String(safeNumber(player?.wage || player?.salary, 0)));
    setContractBonus('');
    setContractYears('3');
    setShowContractModal(true);
  }

  /* =======================================================
     MAKE CONTRACT OFFER
  ======================================================= */

  async function makeContractOffer() {
    if (!contractPlayer || !currentClubId) return;

    const wage = safeNumber(contractWage, 0);
    const bonus = safeNumber(contractBonus, 0);
    const years = safeNumber(contractYears, 3);

    if (wage <= 0) {
      toast.error('Enter a valid weekly wage');
      return;
    }

    if (years <= 0) {
      toast.error('Contract duration is invalid');
      return;
    }

    try {
      setContractLoading(true);

      const contract = {
        id: `${currentClubId}-${contractPlayer.id}-${Date.now()}`,
        clubId: currentClubId,
        clubName: currentClub?.name || '',
        playerId: contractPlayer.id,
        playerName: playerName(contractPlayer),
        weeklyWage: wage,
        signingBonus: bonus,
        years,
        status: 'contract-offered',
        negotiationRound: 1,
        secondChanceUsed: false,
        createdAt: new Date().toISOString(),
        responseDeadline: addDays(new Date(), CONTRACT_WAIT_DAYS),
      };

      await updatePlayer(contractPlayer.id, {
        contractOffers: arrayUnion(contract),
        latestContractOffer: contract,
        transferStatus: 'contract-offered',
      });

      setShowContractModal(false);
      setContractPlayer(null);
      toast.success('Contract offer sent.');
    } catch (error) {
      console.error(error);
      toast.error('Could not send contract offer');
    } finally {
      setContractLoading(false);
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading transfer centre...</p>
      </div>
    );
  }

  if (!user) return null;

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
          <div className={styles.emptyIcon}>🔄</div>
          <h1>No Club Assigned</h1>
          <p>You need to manage a club before negotiating transfers.</p>
          <button type="button" onClick={() => router.push('/club')}>
            Choose Club
          </button>
        </main>
      </>
    );
  }

  /* =======================================================
     BUDGETS
  ======================================================= */

  const transferBudget = safeNumber(
    careerData?.transferBudget,
    currentClub?.transferBudget || 0
  );

  const wageBudget = safeNumber(
    careerData?.wageBudget,
    currentClub?.wageBudget || 0
  );

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>Transfer Centre | {currentClub?.name || 'Club'}</title>
        <meta
          name="description"
          content="Manage transfer bids, contract negotiations, incoming offers and General Manager recommendations."
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.clubLogo}>
              {currentClub?.logo ? <img src={currentClub.logo} alt="" /> : '⚽'}
            </div>
            <div>
              <span className={styles.eyebrow}>FOOTBALL OPERATIONS</span>
              <h1>Transfer Centre</h1>
              <p>{currentClub?.name}</p>
            </div>
          </div>

          <div className={styles.budgetPanel}>
            <div>
              <span>TRANSFER BUDGET</span>
              <strong>€{money(transferBudget)}</strong>
            </div>
            <div>
              <span>WAGE BUDGET</span>
              <strong>€{money(wageBudget)}</strong>
            </div>
          </div>
        </header>

        {/* SUMMARY */}
        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>📥</span>
            <div>
              <small>INCOMING</small>
              <strong>{pendingIncoming}</strong>
              <p>Offers awaiting decision</p>
            </div>
          </article>

          <article className={styles.summaryCard}>
            <span>📤</span>
            <div>
              <small>OUTGOING</small>
              <strong>{pendingOutgoing}</strong>
              <p>Your active bids</p>
            </div>
          </article>

          <article className={styles.summaryCard}>
            <span>✍️</span>
            <div>
              <small>CONTRACTS</small>
              <strong>{contractWaiting}</strong>
              <p>Players considering offers</p>
            </div>
          </article>

          <article className={styles.summaryCard}>
            <span>✅</span>
            <div>
              <small>DEALS</small>
              <strong>{acceptedDeals}</strong>
              <p>Accepted transfers</p>
            </div>
          </article>
        </section>

        {/* GM ALERT */}
        {suggestions.length > 0 && (
          <section className={styles.gmBanner}>
            <div className={styles.gmAvatar}>GM</div>
            <div>
              <span>GENERAL MANAGER</span>
              <strong>I have identified potential recruitment targets.</strong>
              <p>Based on squad needs, budget, and market availability.</p>
            </div>
            <button type="button" onClick={() => setActiveTab('suggestions')}>
              View Recommendations
            </button>
          </section>
        )}

        {/* NAV */}
        <nav className={styles.tabs}>
          <button
            className={activeTab === 'incoming' ? styles.activeTab : ''}
            onClick={() => setActiveTab('incoming')}
          >
            📥 Incoming Bids
            {pendingIncoming > 0 && <b>{pendingIncoming}</b>}
          </button>

          <button
            className={activeTab === 'outgoing' ? styles.activeTab : ''}
            onClick={() => setActiveTab('outgoing')}
          >
            📤 My Bids
          </button>

          <button
            className={activeTab === 'contracts' ? styles.activeTab : ''}
            onClick={() => setActiveTab('contracts')}
          >
            ✍️ Contracts
          </button>

          <button
            className={activeTab === 'suggestions' ? styles.activeTab : ''}
            onClick={() => setActiveTab('suggestions')}
          >
            🧠 GM Suggestions
          </button>
        </nav>

        {/* BID LISTS */}
        {(activeTab === 'incoming' || activeTab === 'outgoing') && (
          <section className={styles.contentCard}>
            <div className={styles.contentHeader}>
              <div>
                <span>TRANSFER MARKET</span>
                <h2>
                  {activeTab === 'incoming'
                    ? 'Offers for Your Players'
                    : 'Your Transfer Bids'}
                </h2>
              </div>

              <div className={styles.headerTools}>
                <div className={styles.search}>
                  🔎
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search player or club..."
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="negotiation">Negotiation</option>
                </select>
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.transferTable}>
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
                    visibleBids.map((bid) => {
                      const player = bid.player;
                      const status = offerStatus(bid);

                      return (
                        <tr key={bid.id}>
                          <td>
                            <button
                              type="button"
                              className={styles.playerButton}
                              onClick={() => router.push(`/player/${player.id}`)}
                            >
                              <div className={styles.avatar}>
                                {player?.photo ? (
                                  <img src={player.photo} alt="" />
                                ) : (
                                  playerName(player).charAt(0).toUpperCase()
                                )}
                              </div>
                              <span>
                                <strong>{playerName(player)}</strong>
                                <small>
                                  {playerPosition(player)} • OVR {playerOverall(player)}
                                </small>
                              </span>
                            </button>
                          </td>

                          <td>
                            <span>{bid.buyerClubName || 'Unknown Club'}</span>
                          </td>

                          <td>
                            <strong className={styles.offerAmount}>
                              €{money(bid.offerAmount)}
                            </strong>
                          </td>

                          <td>€{money(bid.askingPrice || askingPrice(player))}</td>

                          <td>
                            <span className={`${styles.status} ${styles[statusClass(status)]}`}>
                              {statusText(status)}
                            </span>
                          </td>

                          <td>
                            <small className={styles.date}>{formatDate(bid.createdAt)}</small>
                          </td>

                          <td>
                            <div className={styles.actions}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBid(bid);
                                  setShowBidModal(true);
                                }}
                              >
                                View
                              </button>

                              {activeTab === 'incoming' && status === 'pending' && (
                                <>
                                  <button
                                    type="button"
                                    className={styles.acceptButton}
                                    disabled={saving}
                                    onClick={() => acceptBid(bid)}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.rejectButton}
                                    disabled={saving}
                                    onClick={() => rejectBid(bid)}
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="7" className={styles.emptyTable}>
                        <div>
                          <span>📭</span>
                          <strong>No transfer activity</strong>
                          <p>There are no offers matching your filters.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* CONTRACTS TAB */}
        {activeTab === 'contracts' && (
          <section className={styles.contentCard}>
            <div className={styles.contentHeader}>
              <div>
                <span>PLAYER NEGOTIATIONS</span>
                <h2>Contract Offers</h2>
              </div>
            </div>

            <div className={styles.contractGrid}>
              {contractOffers.length > 0 ? (
                contractOffers.map((contract) => {
                  const remaining = daysRemaining(contract.responseDeadline);
                  const player = contract.player;
                  const status = offerStatus(contract);

                  return (
                    <article key={contract.id} className={styles.contractCard}>
                      <div className={styles.contractTop}>
                        <div className={styles.avatarLarge}>
                          {player?.photo ? (
                            <img src={player.photo} alt="" />
                          ) : (
                            playerName(player).charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <span>{playerPosition(player)}</span>
                          <h3>{playerName(player)}</h3>
                          <p>{clubName(player)}</p>
                        </div>
                      </div>

                      <div className={styles.contractStats}>
                        <div>
                          <small>WEEKLY WAGE</small>
                          <strong>€{money(contract.weeklyWage)}</strong>
                        </div>
                        <div>
                          <small>BONUS</small>
                          <strong>€{money(contract.signingBonus)}</strong>
                        </div>
                        <div>
                          <small>TERM</small>
                          <strong>{contract.years || 0} yrs</strong>
                        </div>
                      </div>

                      <div className={styles.contractStatus}>
                        <span className={`${styles.status} ${styles[statusClass(status)]}`}>
                          {statusText(status)}
                        </span>
                        {remaining !== null && (
                          <span>
                            {remaining > 0
                              ? `${remaining} days remaining`
                              : 'Response deadline reached'}
                          </span>
                        )}
                      </div>

                      <div className={styles.contractActions}>
                        {status === 'contract-offered' && (
                          <button
                            type="button"
                            onClick={() => secondNegotiation(contract)}
                            disabled={contract.secondChanceUsed || saving}
                          >
                            {contract.secondChanceUsed
                              ? 'Second Chance Used'
                              : 'Second Negotiation'}
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => router.push(`/player/${player?.id}`)}
                        >
                          View Player
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className={styles.emptyState}>
                  <span>✍️</span>
                  <h3>No active contracts</h3>
                  <p>Contract negotiations will appear here.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* SUGGESTIONS TAB */}
        {activeTab === 'suggestions' && (
          <section className={styles.contentCard}>
            <div className={styles.contentHeader}>
              <div>
                <span>MANAGEMENT INTELLIGENCE</span>
                <h2>General Manager Recommendations</h2>
                <p>Recruitment targets based on squad and budget.</p>
              </div>
              <div className={styles.gmBadge}>🧠 GM</div>
            </div>

            <div className={styles.suggestionGrid}>
              {suggestions.map(({ player, score, reasons }) => (
                <article key={player.id} className={styles.suggestionCard}>
                  <div className={styles.suggestionHeader}>
                    <div className={styles.avatarLarge}>
                      {player.photo ? (
                        <img src={player.photo} alt="" />
                      ) : (
                        playerName(player).charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <span>GM SCORE</span>
                      <strong>{score}</strong>
                    </div>
                  </div>

                  <h3>{playerName(player)}</h3>
                  <p>
                    {playerPosition(player)} • OVR {playerOverall(player)}
                  </p>

                  <div className={styles.suggestionInfo}>
                    <div>
                      <span>VALUE</span>
                      <strong>€{money(playerValue(player))}</strong>
                    </div>
                    <div>
                      <span>ASKING</span>
                      <strong>€{money(askingPrice(player))}</strong>
                    </div>
                  </div>

                  <div className={styles.reasons}>
                    {reasons.map((reason, index) => (
                      <span key={index}>✓ {reason}</span>
                    ))}
                  </div>

                  <div className={styles.suggestionActions}>
                    <button
                      type="button"
                      onClick={() => router.push(`/player/${player.id}`)}
                    >
                      View Player
                    </button>
                    <button
                      type="button"
                      className={styles.acceptButton}
                      onClick={() => router.push(`/players?player=${player.id}`)}
                    >
                      Start Negotiation
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* BID MODAL */}
        {showBidModal && selectedBid && (
          <div className={styles.modalOverlay} onClick={() => setShowBidModal(false)}>
            <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className={styles.close}
                onClick={() => setShowBidModal(false)}
              >
                ×
              </button>

              <span className={styles.eyebrow}>TRANSFER BID</span>
              <h2>{playerName(selectedBid.player)}</h2>
              <p className={styles.modalSubtitle}>
                {selectedBid.buyerClubName} has submitted a transfer offer.
              </p>

              <div className={styles.bidSummary}>
                <div>
                  <span>OFFER</span>
                  <strong>€{money(selectedBid.offerAmount)}</strong>
                </div>
                <div>
                  <span>ASKING PRICE</span>
                  <strong>
                    €{money(selectedBid.askingPrice || askingPrice(selectedBid.player))}
                  </strong>
                </div>
                <div>
                  <span>MARKET VALUE</span>
                  <strong>€{money(playerValue(selectedBid.player))}</strong>
                </div>
              </div>

              <div className={styles.bidMeta}>
                <div>
                  <span>PLAYER</span>
                  <strong>
                    {playerPosition(selectedBid.player)} • OVR{' '}
                    {playerOverall(selectedBid.player)}
                  </strong>
                </div>
                <div>
                  <span>SUBMITTED</span>
                  <strong>{formatDateTime(selectedBid.createdAt)}</strong>
                </div>
                <div>
                  <span>STATUS</span>
                  <strong>{statusText(selectedBid.status)}</strong>
                </div>
              </div>

              {selectedBid.systemResponse && selectedBid.responseNote && (
                <div className={styles.systemResponse}>
                  💬 {selectedBid.responseNote}
                </div>
              )}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => router.push(`/player/${selectedBid.playerId}`)}
                >
                  View Player
                </button>

                {activeTab === 'incoming' &&
                  offerStatus(selectedBid) === 'pending' && (
                    <>
                      <button
                        type="button"
                        className={styles.rejectButton}
                        disabled={saving}
                        onClick={() => rejectBid(selectedBid)}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className={styles.acceptButton}
                        disabled={saving}
                        onClick={() => acceptBid(selectedBid)}
                      >
                        {saving ? 'Processing...' : 'Accept Bid'}
                      </button>
                    </>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* CONTRACT MODAL */}
        {showContractModal && contractPlayer && (
          <div
            className={styles.modalOverlay}
            onClick={() => setShowContractModal(false)}
          >
            <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className={styles.close}
                onClick={() => setShowContractModal(false)}
              >
                ×
              </button>

              <span className={styles.eyebrow}>CONTRACT NEGOTIATION</span>
              <h2>{playerName(contractPlayer)}</h2>
              <p className={styles.modalSubtitle}>
                Offer the player a new contract.
              </p>

              <div className={styles.contractForm}>
                <label>
                  Weekly Wage
                  <div className={styles.moneyInput}>
                    <span>€</span>
                    <input
                      type="number"
                      min="0"
                      value={contractWage}
                      onChange={(event) => setContractWage(event.target.value)}
                      placeholder="0"
                    />
                  </div>
                </label>

                <label>
                  Signing Bonus
                  <div className={styles.moneyInput}>
                    <span>€</span>
                    <input
                      type="number"
                      min="0"
                      value={contractBonus}
                      onChange={(event) => setContractBonus(event.target.value)}
                      placeholder="0"
                    />
                  </div>
                </label>

                <label>
                  Contract Length
                  <select
                    value={contractYears}
                    onChange={(event) => setContractYears(event.target.value)}
                  >
                    <option value="1">1 Year</option>
                    <option value="2">2 Years</option>
                    <option value="3">3 Years</option>
                    <option value="4">4 Years</option>
                    <option value="5">5 Years</option>
                  </select>
                </label>
              </div>

              <div className={styles.contractNotice}>
                ⏱️ The player will have approximately{' '}
                <strong>{CONTRACT_WAIT_DAYS} days</strong> to respond.
              </div>

              <button
                type="button"
                className={styles.primaryButton}
                disabled={contractLoading}
                onClick={makeContractOffer}
              >
                {contractLoading ? 'Sending...' : 'Send Contract Offer'}
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
