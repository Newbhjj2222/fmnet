// lib/match-engine/engine.js

const PYTHON_ENGINE_URL =
  "https://python-engine-1.onrender.com";

/**
 * ---------------------------------------------------------
 * Python API helper
 * ---------------------------------------------------------
 */

async function pythonRequest(path, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(
      `${PYTHON_ENGINE_URL}${path}`,
      {
        ...options,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      }
    );

    const text = await response.text();

    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(
        `Python engine returned invalid JSON (${response.status}). ` +
          `Response: ${text.slice(0, 500)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.detail ||
          data?.message ||
          `Python engine request failed (${response.status})`
      );
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Python football engine request timed out."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ---------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------
 */

function numberValue(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function stringValue(value, fallback = "") {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value);
}

/**
 * Convert player from Firestore/frontend
 * into the format expected by Python.
 */

function cleanPlayer(player = {}, index = 0) {
  const ratings =
    player.ratings ||
    player.stats ||
    {};

  const id =
    player.id ||
    player.playerId ||
    player.uid ||
    player._id ||
    `player-${index + 1}`;

  const name =
    player.name ||
    player.displayName ||
    player.fullName ||
    player.playerName ||
    `Player ${index + 1}`;

  const position =
    player.position ||
    player.preferredPosition ||
    player.role ||
    "CM";

  return {
    id: String(id),

    name: String(name),

    number: numberValue(
      player.number ??
        player.shirtNumber ??
        player.jerseyNumber,
      index + 1
    ),

    position: String(position),

    role: String(
      player.role ||
        player.position ||
        "CM"
    ),

    pace: numberValue(
      player.pace ??
        ratings.pace ??
        ratings.speed,
      68
    ),

    passing: numberValue(
      player.passing ??
        ratings.passing ??
        ratings.pass,
      68
    ),

    shooting: numberValue(
      player.shooting ??
        ratings.shooting ??
        ratings.shoot,
      65
    ),

    dribbling: numberValue(
      player.dribbling ??
        ratings.dribbling ??
        ratings.dribble,
      67
    ),

    defending: numberValue(
      player.defending ??
        ratings.defending ??
        ratings.defence ??
        ratings.defense,
      65
    ),

    stamina: numberValue(
      player.stamina ??
        ratings.stamina,
      75
    ),

    strength: numberValue(
      player.strength ??
        ratings.strength ??
        ratings.physical,
      70
    ),

    vision: numberValue(
      player.vision ??
        ratings.vision,
      68
    ),

    goalkeeping: numberValue(
      player.goalkeeping ??
        ratings.goalkeeping ??
        ratings.gk,
      65
    ),

    composure: numberValue(
      player.composure ??
        ratings.composure,
      65
    ),

    positioning: numberValue(
      player.positioning ??
        ratings.positioning,
      65
    ),

    acceleration: numberValue(
      player.acceleration ??
        ratings.acceleration,
      68
    ),

    aggression: numberValue(
      player.aggression ??
        ratings.aggression,
      60
    ),

    balance: numberValue(
      player.balance ??
        ratings.balance,
      65
    ),
  };
}

/**
 * ---------------------------------------------------------
 * Team cleaner
 * ---------------------------------------------------------
 */

function cleanTeam(
  team = {},
  fallbackName = "Team"
) {
  const rawPlayers =
    Array.isArray(team.players)
      ? team.players
      : Array.isArray(team.lineup)
      ? team.lineup
      : Array.isArray(team.squad)
      ? team.squad
      : [];

  const rawBench =
    Array.isArray(team.bench)
      ? team.bench
      : Array.isArray(team.substitutes)
      ? team.substitutes
      : [];

  const players = rawPlayers.map(
    (player, index) =>
      cleanPlayer(player, index)
  );

  const bench = rawBench.map(
    (player, index) =>
      cleanPlayer(
        player,
        index + players.length
      )
  );

  const tactics = team.tactics || {};

  return {
    id: String(
      team.id ||
        team.clubId ||
        team.teamId ||
        fallbackName.toLowerCase().replace(/\s+/g, "-")
    ),

    name: String(
      team.name ||
        team.clubName ||
        team.teamName ||
        fallbackName
    ),

    logo:
      team.logo ||
      team.logoUrl ||
      team.imageUrl ||
      team.image ||
      "",

    formation:
      team.formation ||
      "4-3-3",

    tactics: {
      mentality:
        tactics.mentality ||
        "balanced",

      tempo: numberValue(
        tactics.tempo,
        60
      ),

      pressing:
        tactics.pressing ||
        "medium",

      defensiveLine:
        tactics.defensiveLine ||
        "medium",

      width: numberValue(
        tactics.width,
        55
      ),
    },

    players,

    bench,

    substitutionsUsed:
      numberValue(
        team.substitutionsUsed,
        0
      ),

    stats:
      team.stats || {},
  };
}

/**
 * ---------------------------------------------------------
 * Match Engine
 * ---------------------------------------------------------
 */

class MatchEngine {
  constructor(config = {}) {
    this.config = config || {};

    this.matchId =
      this.config.matchId ||
      this.config.id ||
      this.config.match?.id ||
      null;

    this.running = false;

    this.finished = false;

    this.destroyed = false;

    this.requestInFlight = false;

    this.lastSnapshot = null;

    /**
     * IMPORTANT:
     *
     * This is what prevents:
     *
     * subscribe is not a function
     *
     * The page can safely call:
     *
     * engine.subscribe(...)
     */
    this.listeners = new Set();

    this.ready = this.create();
  }

  /**
   * -------------------------------------------------------
   * SUBSCRIBE
   * -------------------------------------------------------
   *
   * Allows React/page components to listen for
   * new match states.
   */

  subscribe(listener) {
    if (
      typeof listener !== "function"
    ) {
      return () => {};
    }

    this.listeners.add(listener);

    /**
     * Immediately send the current state
     * if one already exists.
     */
    if (this.lastSnapshot) {
      try {
        listener(this.lastSnapshot);
      } catch (error) {
        console.error(
          "MatchEngine subscriber error:",
          error
        );
      }
    }

    /**
     * Return unsubscribe function.
     */
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * -------------------------------------------------------
   * Notify listeners
   * -------------------------------------------------------
   */

  notify() {
    if (this.destroyed) {
      return;
    }

    for (
      const listener of this.listeners
    ) {
      try {
        listener(this.lastSnapshot);
      } catch (error) {
        console.error(
          "MatchEngine listener error:",
          error
        );
      }
    }
  }

  /**
   * -------------------------------------------------------
   * Create match
   * -------------------------------------------------------
   */

  async create() {
    if (this.destroyed) {
      return null;
    }

    if (!this.matchId) {
      throw new Error(
        "MatchEngine requires a matchId."
      );
    }

    const home = cleanTeam(
      this.config.home ||
        this.config.homeTeam ||
        {},
      "Home Team"
    );

    const away = cleanTeam(
      this.config.away ||
        this.config.awayTeam ||
        {},
      "Away Team"
    );

    /**
     * Do not silently hide missing database players.
     * Python can still provide fallback players,
     * but frontend can detect this situation.
     */

    const payload = {
      matchId: this.matchId,

      home,

      away,

      homeClub:
        this.config.homeClub ||
        null,

      awayClub:
        this.config.awayClub ||
        null,

      metadata:
        this.config.metadata ||
        {},
    };

    try {
      const snapshot =
        await pythonRequest(
          "/match/create",
          {
            method: "POST",
            body: JSON.stringify(
              payload
            ),
          }
        );

      this.applySnapshot(
        snapshot
      );

      return snapshot;
    } catch (error) {
      console.error(
        "Failed to create Python match:",
        error
      );

      throw error;
    }
  }

  /**
   * -------------------------------------------------------
   * Apply snapshot
   * -------------------------------------------------------
   */

  applySnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    this.lastSnapshot = snapshot;

    this.status =
      snapshot.status ||
      "created";

    this.minute =
      numberValue(
        snapshot.minute,
        0
      );

    this.second =
      numberValue(
        snapshot.second,
        0
      );

    this.score =
      snapshot.score || {
        home: 0,
        away: 0,
      };

    this.home =
      snapshot.home || null;

    this.away =
      snapshot.away || null;

    this.ball =
      snapshot.ball || null;

    this.events =
      Array.isArray(
        snapshot.events
      )
        ? snapshot.events
        : [];

    this.lastEvent =
      snapshot.lastEvent ||
      null;

    this.stats =
      snapshot.stats || {};

    this.result =
      snapshot.result ||
      null;

    this.playerStamina =
      snapshot.playerStamina ||
      {};

    this.homeScore =
      numberValue(
        snapshot.homeScore,
        this.score.home
      );

    this.awayScore =
      numberValue(
        snapshot.awayScore,
        this.score.away
      );

    if (
      this.status ===
      "finished"
    ) {
      this.finished = true;
      this.running = false;
    } else if (
      this.status ===
      "playing"
    ) {
      this.running = true;
    } else {
      this.running = false;
    }

    /**
     * Notify React/page listeners.
     */
    this.notify();
  }

  /**
   * -------------------------------------------------------
   * Start
   * -------------------------------------------------------
   */

  async start() {
    await this.ready;

    if (this.destroyed) {
      throw new Error(
        "MatchEngine has been destroyed."
      );
    }

    if (this.finished) {
      return this.lastSnapshot;
    }

    const snapshot =
      await pythonRequest(
        `/match/${encodeURIComponent(
          this.matchId
        )}/start`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }

  /**
   * -------------------------------------------------------
   * Resume
   * -------------------------------------------------------
   */

  async resume() {
    return this.start();
  }

  /**
   * -------------------------------------------------------
   * Pause
   * -------------------------------------------------------
   */

  async pause() {
    await this.ready;

    if (this.destroyed) {
      return this.lastSnapshot;
    }

    const snapshot =
      await pythonRequest(
        `/match/${encodeURIComponent(
          this.matchId
        )}/pause`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }

  /**
   * -------------------------------------------------------
   * Poll state
   * -------------------------------------------------------
   *
   * The Python engine controls the actual clock.
   *
   * DO NOT calculate match minutes here.
   */

  async update() {
    if (
      this.destroyed ||
      !this.matchId
    ) {
      return this.lastSnapshot;
    }

    if (
      this.requestInFlight
    ) {
      return this.lastSnapshot;
    }

    this.requestInFlight = true;

    try {
      const snapshot =
        await pythonRequest(
          `/match/${encodeURIComponent(
            this.matchId
          )}/state`,
          {
            method: "GET",
          }
        );

      this.applySnapshot(
        snapshot
      );

      return snapshot;
    } catch (error) {
      console.error(
        "Match state update failed:",
        error
      );

      /**
       * Do not destroy the match just
       * because one polling request failed.
       */
      return this.lastSnapshot;
    } finally {
      this.requestInFlight =
        false;
    }
  }

  /**
   * -------------------------------------------------------
   * Tactics
   * -------------------------------------------------------
   */

  async setUserTactics(
    tactics = {}
  ) {
    await this.ready;

    if (this.destroyed) {
      return this.lastSnapshot;
    }

    const snapshot =
      await pythonRequest(
        `/match/${encodeURIComponent(
          this.matchId
        )}/tactics`,
        {
          method: "POST",

          body: JSON.stringify({
            side: "home",
            tactics: {
              mentality:
                tactics.mentality ||
                "balanced",

              tempo:
                numberValue(
                  tactics.tempo,
                  60
                ),

              pressing:
                tactics.pressing ||
                "medium",

              defensiveLine:
                tactics.defensiveLine ||
                "medium",

              width:
                numberValue(
                  tactics.width,
                  55
                ),
            },
          }),
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }

  /**
   * -------------------------------------------------------
   * Formation
   * -------------------------------------------------------
   */

  async setFormation(
    formation
  ) {
    await this.ready;

    if (this.destroyed) {
      return this.lastSnapshot;
    }

    if (!formation) {
      throw new Error(
        "Formation is required."
      );
    }

    const snapshot =
      await pythonRequest(
        `/match/${encodeURIComponent(
          this.matchId
        )}/formation`,
        {
          method: "POST",

          body: JSON.stringify({
            side: "home",
            formation,
          }),
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }

  /**
   * -------------------------------------------------------
   * Substitution
   * -------------------------------------------------------
   */

  async substituteUser(
    outgoingId,
    incomingId
  ) {
    await this.ready;

    if (this.destroyed) {
      return this.lastSnapshot;
    }

    if (
      !outgoingId ||
      !incomingId
    ) {
      throw new Error(
        "Both outgoingId and incomingId are required."
      );
    }

    const snapshot =
      await pythonRequest(
        `/match/${encodeURIComponent(
          this.matchId
        )}/substitute`,
        {
          method: "POST",

          body: JSON.stringify({
            side: "home",
            outgoingId:
              String(outgoingId),
            incomingId:
              String(incomingId),
          }),
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }

  /**
   * -------------------------------------------------------
   * Finish
   * -------------------------------------------------------
   */

  async finish() {
    await this.ready;

    if (this.destroyed) {
      return this.lastSnapshot;
    }

    const snapshot =
      await pythonRequest(
        `/match/${encodeURIComponent(
          this.matchId
        )}/finish`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }

  /**
   * -------------------------------------------------------
   * Get current state
   * -------------------------------------------------------
   */

  getState() {
    return this.lastSnapshot;
  }

  getSnapshot() {
    return this.lastSnapshot;
  }

  /**
   * -------------------------------------------------------
   * Is finished?
   * -------------------------------------------------------
   */

  isFinished() {
    return (
      this.finished ||
      this.status === "finished"
    );
  }

  /**
   * -------------------------------------------------------
   * Is running?
   * -------------------------------------------------------
   */

  isRunning() {
    return (
      this.running &&
      !this.finished &&
      !this.destroyed
    );
  }

  /**
   * -------------------------------------------------------
   * Stop local engine
   * -------------------------------------------------------
   *
   * This does NOT tell Python to stop.
   * It only stops local polling/usage.
   */

  stop() {
    this.running = false;
  }

  /**
   * -------------------------------------------------------
   * Destroy
   * -------------------------------------------------------
   */

  destroy() {
    this.destroyed = true;

    this.running = false;

    this.finished = true;

    this.listeners.clear();
  }

  /**
   * -------------------------------------------------------
   * Serialize result
   * -------------------------------------------------------
   */

  serializeResult() {
    const snapshot =
      this.lastSnapshot || {};

    const score =
      snapshot.score || {
        home: 0,
        away: 0,
      };

    return {
      matchId:
        snapshot.matchId ||
        this.matchId,

      status:
        snapshot.status ||
        this.status ||
        "created",

      minute:
        numberValue(
          snapshot.minute,
          this.minute || 0
        ),

      second:
        numberValue(
          snapshot.second,
          this.second || 0
        ),

      score: {
        home:
          numberValue(
            score.home,
            0
          ),

        away:
          numberValue(
            score.away,
            0
          ),
      },

      home:
        snapshot.home ||
        this.home ||
        null,

      away:
        snapshot.away ||
        this.away ||
        null,

      ball:
        snapshot.ball ||
        this.ball ||
        null,

      stats:
        snapshot.stats ||
        this.stats ||
        {},

      events:
        Array.isArray(
          snapshot.events
        )
          ? snapshot.events
          : this.events || [],

      lastEvent:
        snapshot.lastEvent ||
        this.lastEvent ||
        null,

      result:
        snapshot.result ||
        this.result ||
        null,
    };
  }
}

/**
 * ---------------------------------------------------------
 * Default export
 * ---------------------------------------------------------
 */

export default MatchEngine;

/**
 * ---------------------------------------------------------
 * Named exports
 * ---------------------------------------------------------
 */

export {
  MatchEngine,
  pythonRequest,
  cleanPlayer,
  cleanTeam,
};
