// src/hooks/useMatchEngine.js

import { useState, useCallback, useRef } from 'react';
import {
  MATCH_DURATION,
  FIRST_HALF_END,
  MAX_SUBSTITUTIONS,
  TACTICS,
  EVENT_TYPES,
} from '../utils/matchConstants';
import {
  safeNumber,
  clamp,
  pick,
  getPlayerName,
  getPlayerPosition,
  getPlayerOverall,
  playerId,
  calculateTeamStrength,
  calculateGroupStrength,
  getBestPlayer,
  normalizePosition,
} from '../utils/matchHelpers';

export function useMatchEngine() {
  const [matchMinute, setMatchMinute] = useState(0);
  const [matchStatus, setMatchStatus] = useState('ready');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [events, setEvents] = useState([]);
  const [homeStats, setHomeStats] = useState(createDefaultStats());
  const [awayStats, setAwayStats] = useState(createDefaultStats());
  const [substitutionsUsed, setSubstitutionsUsed] = useState(0);
  const [playerStamina, setPlayerStamina] = useState({ home: {}, away: {} });
  const [ballPossession, setBallPossession] = useState(null);
  const [isPaused, setIsPaused] = useState(false);

  const statsRef = useRef({ home: createDefaultStats(), away: createDefaultStats() });
  const eventsRef = useRef([]);
  const scoreRef = useRef({ home: 0, away: 0 });
  const staminaRef = useRef({ home: {}, away: {} });

  const simulateMinute = useCallback((minute, homeXI, awayXI, formation, tactic, mentality) => {
    // Calculate team performance
    const homePerformance = calculateTeamPerformance(homeXI, formation, tactic, mentality, true, staminaRef.current.home);
    const awayPerformance = calculateTeamPerformance(awayXI, formation, tactic, 'balanced', false, staminaRef.current.away);

    // Update possession
    const midfieldDiff = homePerformance.midfield - awayPerformance.midfield;
    const possessionShift = clamp(midfieldDiff * 0.003, -0.35, 0.35);
    const currentPossession = safeNumber(statsRef.current.home.possession, 50);
    const nextPossession = clamp(currentPossession + possessionShift + (Math.random() - 0.5) * 0.04, 20, 80);
    
    statsRef.current.home.possession = Number(nextPossession.toFixed(2));
    statsRef.current.away.possession = Number((100 - nextPossession).toFixed(2));

    // Determine which team has possession
    const homeChance = nextPossession / 100;
    const team = Math.random() < homeChance ? 'home' : 'away';
    const players = team === 'home' ? homeXI : awayXI;
    const opponentPlayers = team === 'home' ? awayXI : homeXI;
    const attackingPerformance = team === 'home' ? homePerformance : awayPerformance;
    const defendingPerformance = team === 'home' ? awayPerformance : homePerformance;

    // Select attacker
    const attackerCandidates = players.filter(p => {
      const pos = normalizePosition(getPlayerPosition(p));
      return pos === 'ATT' || pos === 'MID';
    });
    const selectedPlayer = getBestPlayer(attackerCandidates) || pick(players);
    if (!selectedPlayer) return;

    const playerIndex = players.findIndex(p => String(playerId(p)) === String(playerId(selectedPlayer)));
    if (playerIndex < 0) return;

    setBallPossession({ team, playerIndex });

    // Decrease stamina
    const pos = normalizePosition(getPlayerPosition(selectedPlayer));
    const staminaLoss = pos === 'ATT' ? 0.35 : pos === 'MID' ? 0.45 : 0.25;
    const pid = playerId(selectedPlayer);
    if (pid && staminaRef.current[team][pid] !== undefined) {
      staminaRef.current[team][pid] = clamp(safeNumber(staminaRef.current[team][pid], 100) - staminaLoss, 0, 100);
      setPlayerStamina({ ...staminaRef.current });
    }

    // Action
    const tacticData = TACTICS[tactic] || TACTICS['Tiki-Taka'];
    const actionRandom = Math.random();

    // Pass
    if (actionRandom < tacticData.passChance) {
      const teammates = players.filter(p => String(playerId(p)) !== String(playerId(selectedPlayer)));
      const teammate = pick(teammates);
      if (teammate) {
        const idx = players.findIndex(p => String(playerId(p)) === String(playerId(teammate)));
        if (idx >= 0) {
          setBallPossession({ team, playerIndex: idx });
          statsRef.current[team].passes += 1;
          setHomeStats({ ...statsRef.current.home });
          setAwayStats({ ...statsRef.current.away });
        }
      }
      return;
    }

    // Shot
    const shotRandom = Math.random();
    const goalX = team === 'home' ? 14 : -14;
    const distanceToGoal = Math.abs(selectedPlayer.position?.x || 0 - goalX);
    const shotProbability = calculateShotProbability(selectedPlayer, attackingPerformance, defendingPerformance, pos, distanceToGoal);
    const qualityBonus = getPlayerOverall(selectedPlayer) >= 85 ? 0.12 : 
                         getPlayerOverall(selectedPlayer) >= 75 ? 0.07 : 0.03;
    const finalShotProb = clamp(shotProbability + qualityBonus, 0.02, 0.65);

    if (shotRandom < finalShotProb) {
      statsRef.current[team].shots += 1;
      
      const onTargetProb = clamp(0.42 + getPlayerOverall(selectedPlayer) / 100 * 0.32 +
        attackingPerformance.attack / 500 - defendingPerformance.defence / 700, 0.25, 0.90);
      
      if (Math.random() < onTargetProb) {
        statsRef.current[team].shotsOnTarget += 1;
        
        const goalProb = calculateGoalProbability(selectedPlayer, attackingPerformance, defendingPerformance, distanceToGoal);
        if (Math.random() < goalProb) {
          // GOAL!
          scoreRef.current[team] += 1;
          setHomeScore(scoreRef.current.home);
          setAwayScore(scoreRef.current.away);
          
          const goalEvent = {
            id: `${Date.now()}-goal`,
            type: EVENT_TYPES.GOAL,
            team,
            minute,
            playerName: getPlayerName(selectedPlayer),
            detail: `${getPlayerName(selectedPlayer)} scored!`,
          };
          eventsRef.current = [goalEvent, ...eventsRef.current];
          setEvents([...eventsRef.current]);
          setBallPossession(null);
        } else {
          // Save
          const defendingTeam = team === 'home' ? 'away' : 'home';
          statsRef.current[defendingTeam].saves += 1;
          const keeper = getBestPlayer(opponentPlayers, ['GK']);
          const saveEvent = {
            id: `${Date.now()}-save`,
            type: EVENT_TYPES.SAVE,
            team: defendingTeam,
            minute,
            playerName: keeper ? getPlayerName(keeper) : 'Goalkeeper',
            detail: 'Save made!',
          };
          eventsRef.current = [saveEvent, ...eventsRef.current];
          setEvents([...eventsRef.current]);
          setBallPossession({ team: defendingTeam, playerIndex: 0 });
        }
      } else {
        // Shot off target
        const shotEvent = {
          id: `${Date.now()}-shot`,
          type: EVENT_TYPES.SHOT,
          team,
          minute,
          playerName: getPlayerName(selectedPlayer),
          detail: 'Shot off target',
        };
        eventsRef.current = [shotEvent, ...eventsRef.current];
        setEvents([...eventsRef.current]);
      }
    }

    setHomeStats({ ...statsRef.current.home });
    setAwayStats({ ...statsRef.current.away });
  }, []);

  return {
    matchMinute,
    setMatchMinute,
    matchStatus,
    setMatchStatus,
    homeScore,
    awayScore,
    events,
    homeStats,
    awayStats,
    substitutionsUsed,
    setSubstitutionsUsed,
    playerStamina,
    setPlayerStamina,
    ballPossession,
    setBallPossession,
    isPaused,
    setIsPaused,
    statsRef,
    eventsRef,
    scoreRef,
    staminaRef,
    simulateMinute,
  };
}

function createDefaultStats() {
  return {
    shots: 0,
    shotsOnTarget: 0,
    possession: 50,
    passes: 0,
    fouls: 0,
    corners: 0,
    offsides: 0,
    yellow: 0,
    red: 0,
    saves: 0,
    tackles: 0,
    interceptions: 0,
  };
}

function calculateTeamPerformance(players, formation, tactic, mentality, isHome, stamina) {
  const strength = calculateTeamStrength(players);
  const attack = calculateGroupStrength(players, 'ATT');
  const midfield = calculateGroupStrength(players, 'MID');
  const defence = calculateGroupStrength(players, 'DEF');
  const goalkeeper = calculateGroupStrength(players, 'GK');
  
  const tacticData = TACTICS[tactic] || TACTICS['Tiki-Taka'];
  const staminaValues = Object.values(stamina || {});
  const avgStamina = staminaValues.length ? 
    staminaValues.reduce((s, v) => s + safeNumber(v, 100), 0) / staminaValues.length : 100;
  const staminaFactor = 0.82 + clamp(avgStamina, 0, 100) / 100 * 0.18;
  
  return {
    overall: strength,
    attack: attack * tacticData.attackModifier * staminaFactor * (isHome ? 1.035 : 1),
    midfield: midfield * staminaFactor,
    defence: defence * tacticData.defenceModifier * staminaFactor,
    goalkeeper: goalkeeper * staminaFactor,
    homeFactor: isHome ? 1.035 : 1,
  };
}

function calculateShotProbability(attacker, attackingTeam, defendingTeam, position, distance) {
  const attackerOverall = getPlayerOverall(attacker);
  const positionFactor = position === 'ATT' ? 1.2 : position === 'MID' ? 0.9 : 0.45;
  const distanceFactor = clamp(1.25 - distance / 20, 0.45, 1.25);
  const attackVsDefence = clamp((attackingTeam.attack - defendingTeam.defence + 50) / 100, 0.55, 1.45);
  
  const raw = 0.24 * (0.75 + attackerOverall / 100 * 0.55) * attackVsDefence * 
    (0.85 + attackingTeam.midfield / 100 * 0.30) * positionFactor * distanceFactor *
    (1 - clamp((defendingTeam.goalkeeper - 50) / 300, -0.08, 0.16)) * attackingTeam.homeFactor;
  
  return clamp(raw, 0.02, 0.55);
}

function calculateGoalProbability(attacker, attackingTeam, defendingTeam, distance) {
  const attackerOverall = getPlayerOverall(attacker);
  const attackQuality = clamp(attackingTeam.attack / 100, 0.45, 1.2);
  const attackerQuality = clamp(attackerOverall / 100, 0.4, 1.1);
  const goalkeeperResistance = clamp(1 - (defendingTeam.goalkeeper - 50) / 300, 0.7, 1.08);
  const distanceFactor = clamp(1.2 - distance / 30, 0.55, 1.2);
  
  const raw = 0.27 * attackQuality * attackerQuality * goalkeeperResistance * distanceFactor * attackingTeam.homeFactor;
  return clamp(raw, 0.04, 0.65);
}
