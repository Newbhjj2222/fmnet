const PYTHON_ENGINE_URL =
  "https://python-engine-1.onrender.com";

async function requestPython(
  path,
  options = {}
) {
  const response = await fetch(
    `${PYTHON_ENGINE_URL}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text
      ? JSON.parse(text)
      : {};
  } catch {
    throw new Error(
      `Invalid response from match engine: ${text.slice(
        0,
        300
      )}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.detail ||
        `Match engine error ${response.status}`
    );
  }

  return data;
}

function num(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function cleanPlayer(
  player = {},
  index = 0
) {
  const ratings =
    player.ratings || {};

  return {
    id: String(
      player.id ||
        player.playerId ||
        player.uid ||
        `player-${index + 1}`
    ),

    name:
      player.name ||
      player.displayName ||
      player.fullName ||
      `Player ${index + 1}`,

    number: num(
      player.number ||
        player.shirtNumber ||
        player.jerseyNumber ||
        index + 1,
      index + 1
    ),

    position:
      player.position ||
      player.role ||
      "CM",

    role:
      player.role ||
      player.position ||
      "CM",

    pace: num(
      player.pace ??
        ratings.pace,
      70
    ),

    passing: num(
      player.passing ??
        ratings.passing,
      70
    ),

    shooting: num(
      player.shooting ??
        ratings.shooting,
      65
    ),

    dribbling: num(
      player.dribbling ??
        ratings.dribbling,
      68
    ),

    defending: num(
      player.defending ??
        ratings.defending,
      65
    ),

    stamina: num(
      player.stamina ??
        ratings.stamina,
      80
    ),

    strength: num(
      player.strength ??
        ratings.strength,
      70
    ),

    vision: num(
      player.vision ??
        ratings.vision,
      70
    ),

    goalkeeping: num(
      player.goalkeeping ??
        ratings.goalkeeping,
      60
    ),
  };
}

function cleanTeam(
  team = {},
  fallbackName
) {
  const players =
    Array.isArray(team.players)
      ? team.players
      : Array.isArray(team.lineup)
      ? team.lineup
      : [];

  const bench =
    Array.isArray(team.bench)
      ? team.bench
      : Array.isArray(team.substitutes)
      ? team.substitutes
      : [];

  return {
    id:
      team.id ||
      team.clubId ||
      team.teamId ||
      fallbackName.toLowerCase(),

    name:
      team.name ||
      team.clubName ||
      fallbackName,

    logo:
      team.logo ||
      team.logoUrl ||
      team.image ||
      "",

    formation:
      team.formation ||
      "4-3-3",

    tactics:
      team.tactics || {},

    players: players.map(
      cleanPlayer
    ),

    bench: bench.map(
      (player, index) =>
        cleanPlayer(
          player,
          index + 11
        )
    ),
  };
}


class MatchEngine {
  constructor(config = {}) {
    this.config = config;

    this.matchId =
      config.matchId ||
      config.id;

    this.lastSnapshot = null;

    this.ready = null;

    this.requestInFlight = false;

    this.pollTimer = null;

    this.listeners = new Set();

    this.ready = this.create();
  }


  subscribe(listener) {
    if (
      typeof listener !==
      "function"
    ) {
      return () => {};
    }

    this.listeners.add(
      listener
    );

    if (this.lastSnapshot) {
      listener(
        this.lastSnapshot
      );
    }

    return () => {
      this.listeners.delete(
        listener
      );
    };
  }


  emit(snapshot) {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error(
          "Match listener error:",
          error
        );
      }
    }
  }


  async create() {
    const payload = {
      ...this.config,

      matchId:
        this.matchId,

      home: cleanTeam(
        this.config.home || {},
        "Home Team"
      ),

      away: cleanTeam(
        this.config.away || {},
        "Away Team"
      ),
    };

    if (
      payload.home.players.length < 11
    ) {
      console.warn(
        "Home team has fewer than 11 players"
      );
    }

    if (
      payload.away.players.length < 11
    ) {
      console.warn(
        "Away team has fewer than 11 players"
      );
    }

    const snapshot =
      await requestPython(
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
  }


  applySnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    this.lastSnapshot =
      snapshot;

    this.status =
      snapshot.status ||
      "created";

    this.minute =
      num(snapshot.minute);

    this.second =
      num(snapshot.second);

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

    this.stats =
      snapshot.stats || {};

    this.emit(snapshot);
  }


  async start() {
    await this.ready;

    const snapshot =
      await requestPython(
        `/match/${this.matchId}/start`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    this.startPolling();

    return snapshot;
  }


  async resume() {
    return this.start();
  }


  async pause() {
    await this.ready;

    const snapshot =
      await requestPython(
        `/match/${this.matchId}/pause`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    this.stopPolling();

    return snapshot;
  }


  async update() {
    if (
      this.requestInFlight ||
      !this.matchId
    ) {
      return this.lastSnapshot;
    }

    this.requestInFlight = true;

    try {
      const snapshot =
        await requestPython(
          `/match/${this.matchId}/state`
        );

      this.applySnapshot(
        snapshot
      );

      return snapshot;
    } catch (error) {
      console.error(
        "Match state error:",
        error
      );

      return this.lastSnapshot;
    } finally {
      this.requestInFlight = false;
    }
  }


  startPolling() {
    this.stopPolling();

    this.pollTimer =
      setInterval(() => {
        this.update();
      }, 500);
  }


  stopPolling() {
    if (this.pollTimer) {
      clearInterval(
        this.pollTimer
      );

      this.pollTimer = null;
    }
  }


  async setUserTactics(
    tactics
  ) {
    await this.ready;

    const snapshot =
      await requestPython(
        `/match/${this.matchId}/tactics`,
        {
          method: "POST",
          body: JSON.stringify({
            side: "home",
            tactics,
          }),
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }


  async setFormation(
    formation
  ) {
    await this.ready;

    const snapshot =
      await requestPython(
        `/match/${this.matchId}/formation`,
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


  async substituteUser(
    outgoingId,
    incomingId
  ) {
    await this.ready;

    const snapshot =
      await requestPython(
        `/match/${this.matchId}/substitute`,
        {
          method: "POST",
          body: JSON.stringify({
            side: "home",
            outgoingId,
            incomingId,
          }),
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }


  async finish() {
    await this.ready;

    const snapshot =
      await requestPython(
        `/match/${this.matchId}/finish`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    this.stopPolling();

    return snapshot;
  }


  isFinished() {
    return (
      this.status ===
      "finished"
    );
  }


  getState() {
    return this.lastSnapshot;
  }


  destroy() {
    this.stopPolling();
    this.listeners.clear();
  }
}


export default MatchEngine;
