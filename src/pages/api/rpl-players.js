// pages/api/rpl.js

import { URL } from "url";

// ============================================================
// RWANDA PREMIER LEAGUE SCRAPER
// ============================================================

const RPL_ORIGIN =
  "https://rwandapremierleague.rw";

const RPL_TEAM_URL =
  `${RPL_ORIGIN}/info/team`;

const RPL_PLAYERS_URL =
  `${RPL_ORIGIN}/players`;

const MAX_PLAYER_PAGES = 59;

const REQUEST_TIMEOUT = 20000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; VirtualFootballManager/1.0)";

// ============================================================
// HTML HELPERS
// ============================================================

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(Number(code));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      try {
        return String.fromCharCode(
          parseInt(code, 16)
        );
      } catch {
        return _;
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value = "") {
  return decodeHtml(
    String(value)
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<noscript[\s\S]*?<\/noscript>/gi,
        " "
      )
      .replace(
        /<!--[\s\S]*?-->/g,
        " "
      )
      .replace(/<[^>]+>/g, " ")
  );
}

function cleanText(value = "") {
  return stripHtml(value)
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value = "") {
  if (!value) {
    return "";
  }

  try {
    return new URL(
      value,
      RPL_ORIGIN
    ).toString();
  } catch {
    return value;
  }
}

function extractAttribute(
  tag = "",
  attribute = ""
) {
  const regex = new RegExp(
    `${attribute}\\s*=\\s*["']([^"']+)["']`,
    "i"
  );

  const match =
    String(tag).match(regex);

  return match
    ? decodeHtml(match[1])
    : "";
}

function extractImage(tag = "") {
  return (
    extractAttribute(tag, "src") ||
    extractAttribute(
      tag,
      "data-src"
    ) ||
    extractAttribute(
      tag,
      "data-lazy-src"
    ) ||
    extractAttribute(
      tag,
      "data-original"
    ) ||
    ""
  );
}

// ============================================================
// NUMBER HELPERS
// ============================================================

function parseNumber(value) {
  const text =
    cleanText(value);

  if (!text) {
    return 0;
  }

  const match =
    text.match(/-?\d+(?:\.\d+)?/);

  if (!match) {
    return 0;
  }

  const number =
    Number(match[0]);

  return Number.isFinite(number)
    ? number
    : 0;
}

function parsePercentage(value) {
  const text =
    cleanText(value);

  const match =
    text.match(
      /-?\d+(?:\.\d+)?\s*%/
    );

  if (!match) {
    return 0;
  }

  return parseNumber(match[0]);
}

// ============================================================
// POSITION
// ============================================================

function mapPosition(value) {
  const position =
    cleanText(value)
      .toLowerCase();

  if (
    position.includes(
      "goalkeeper"
    ) ||
    position.includes(
      "keeper"
    )
  ) {
    return "GK";
  }

  if (
    position.includes(
      "defender"
    ) ||
    position.includes(
      "defence"
    ) ||
    position.includes(
      "defense"
    )
  ) {
    return "DEF";
  }

  if (
    position.includes(
      "midfielder"
    ) ||
    position.includes(
      "midfield"
    )
  ) {
    return "MID";
  }

  if (
    position.includes(
      "forward"
    ) ||
    position.includes(
      "striker"
    ) ||
    position.includes(
      "attacker"
    )
  ) {
    return "FWD";
  }

  return "MID";
}

// ============================================================
// TABLE PARSER
// ============================================================

function extractTableRows(html) {
  const rows = [];

  const rowMatches =
    String(html).match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    );

  if (!rowMatches) {
    return rows;
  }

  for (
    const rowHtml of rowMatches
  ) {
    const cellMatches =
      rowHtml.match(
        /<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi
      );

    if (!cellMatches) {
      continue;
    }

    const cells =
      cellMatches.map(
        (cell) => {
          const imageTag =
            cell.match(
              /<img\b[^>]*>/i
            );

          return {
            text:
              cleanText(cell),

            image:
              imageTag
                ? absoluteUrl(
                    extractImage(
                      imageTag[0]
                    )
                  )
                : "",
          };
        }
      );

    if (
      cells.length === 0
    ) {
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

// ============================================================
// PLAYERS FROM /PLAYERS
// ============================================================

function parsePlayersFromHtml(
  html
) {
  const players = [];

  const rows =
    extractTableRows(html);

  for (
    const cells of rows
  ) {
    if (
      cells.length < 4
    ) {
      continue;
    }

    const name =
      cleanText(
        cells[0]?.text
      );

    const clubName =
      cleanText(
        cells[1]?.text
      );

    const positionLabel =
      cleanText(
        cells[2]?.text
      );

    const nationality =
      cleanText(
        cells[3]?.text
      );

    if (
      !name ||
      !clubName
    ) {
      continue;
    }

    const lowerName =
      name.toLowerCase();

    if (
      lowerName === "player" ||
      lowerName === "rank" ||
      lowerName === "name"
    ) {
      continue;
    }

    if (
      name.length > 150 ||
      clubName.length > 120
    ) {
      continue;
    }

    players.push({
      name,

      clubName,

      position:
        mapPosition(
          positionLabel
        ),

      positionLabel,

      nationality,

      photo:
        cells[0]?.image ||
        "",

      clubLogo:
        cells[1]?.image ||
        "",
    });
  }

  return players;
}

// ============================================================
// TEAM SELECTOR
//
// The RPL Team Management page contains a Club <select>.
// We extract its options instead of hard-coding clubs.
// ============================================================

function extractTeamOptions(
  html
) {
  const teams = [];

  const selectMatches =
    String(html).match(
      /<select\b[^>]*>[\s\S]*?<\/select>/gi
    ) || [];

  for (
    const selectHtml of selectMatches
  ) {
    const selectText =
      cleanText(selectHtml)
        .toLowerCase();

    /*
     * We are specifically looking
     * for the selector containing
     * "club".
     */

    const optionMatches =
      selectHtml.match(
        /<option\b[^>]*>[\s\S]*?<\/option>/gi
      ) || [];

    if (
      optionMatches.length === 0
    ) {
      continue;
    }

    const looksLikeClubSelector =
      /club/i.test(
        selectHtml
      ) ||
      optionMatches.some(
        (option) =>
          /APR FC/i.test(
            cleanText(option)
          ) ||
          /Rayon Sports/i.test(
            cleanText(option)
          ) ||
          /Al Hilal SC/i.test(
            cleanText(option)
          )
      );

    if (
      !looksLikeClubSelector
    ) {
      continue;
    }

    for (
      const optionHtml of optionMatches
    ) {
      const name =
        cleanText(
          optionHtml
        );

      const value =
        extractAttribute(
          optionHtml,
          "value"
        );

      if (
        !name ||
        name.toLowerCase() ===
          "select"
      ) {
        continue;
      }

      teams.push({
        name,
        value,
      });
    }

    if (
      teams.length > 0
    ) {
      break;
    }
  }

  /*
   * Deduplicate.
   */

  const seen =
    new Set();

  return teams.filter(
    (team) => {
      const key =
        `${team.name}`
          .toLowerCase()
          .trim();

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

// ============================================================
// EXTRACT TEAM PROFILE FROM HTML
// ============================================================

function extractTeamProfile(
  html,
  selectedTeam = ""
) {
  const text =
    cleanText(html);

  const team = {
    name:
      selectedTeam || "",

    logo: "",

    established: "",

    rank: 0,

    rankLabel: "",

    squadSize: 0,

    winRate: 0,

    recentForm: [],

    email: "",

    phone: "",

    leadership: {
      captain: "",
      headCoach: "",
      president: "",
    },

    players: [],

    coaches: [],

    committee: [],

    season: {
      position: 0,
      played: 0,
      points: 0,
      goalDifference: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
    },

    fixtures: [],

    topScorers: [],

    topAssists: [],

    latestNews: [],
  };

  // ========================================================
  // LOGO
  // ========================================================

  /*
   * Find image whose alt contains the team name.
   */

  if (
    selectedTeam
  ) {
    const escaped =
      selectedTeam.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const logoRegex =
      new RegExp(
        `<img\\b[^>]*(?:alt|title)\\s*=\\s*["'][^"']*${escaped}[^"']*["'][^>]*>`,
        "i"
      );

    const logoMatch =
      html.match(
        logoRegex
      );

    if (logoMatch) {
      team.logo =
        absoluteUrl(
          extractImage(
            logoMatch[0]
          )
        );
    }
  }

  /*
   * Fallback: first reasonably likely
   * team image near Team Management.
   */

  if (!team.logo) {
    const imageMatches =
      html.match(
        /<img\b[^>]*>/gi
      ) || [];

    for (
      const imageTag of imageMatches
    ) {
      const alt =
        extractAttribute(
          imageTag,
          "alt"
        );

      const src =
        extractImage(
          imageTag
        );

      const altText =
        cleanText(alt)
          .toLowerCase();

      if (
        selectedTeam &&
        altText.includes(
          selectedTeam
            .toLowerCase()
        )
      ) {
        team.logo =
          absoluteUrl(src);

        break;
      }
    }
  }

  // ========================================================
  // ESTABLISHED
  // ========================================================

  const establishedMatch =
    text.match(
      /Est\.\s*(\d{4})/i
    );

  if (
    establishedMatch
  ) {
    team.established =
      establishedMatch[1];
  }

  // ========================================================
  // RANK
  // ========================================================

  const rankMatch =
    text.match(
      /(\d+)(?:st|nd|rd|th)\s+of\s+(\d+)/i
    );

  if (
    rankMatch
  ) {
    team.rank =
      Number(
        rankMatch[1]
      );

    team.rankLabel =
      `${rankMatch[1]} of ${rankMatch[2]}`;
  }

  // ========================================================
  // CONTACT
  // ========================================================

  const emailMatch =
    text.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
    );

  if (
    emailMatch
  ) {
    team.email =
      emailMatch[0];
  }

  const phoneMatch =
    text.match(
      /(?:\+?250[\s-]?)?(?:07\d|078|079|072|073|077|078|079)[\d\s-]{6,}/
    );

  if (
    phoneMatch
  ) {
    team.phone =
      cleanText(
        phoneMatch[0]
      );
  }

  // ========================================================
  // SQUAD
  // ========================================================

  const squadMatch =
    text.match(
      /Squad\s+(\d+)/i
    );

  if (
    squadMatch
  ) {
    team.squadSize =
      Number(
        squadMatch[1]
      );
  }

  // ========================================================
  // WIN RATE
  // ========================================================

  const winRateMatch =
    text.match(
      /Win rate\s+(\d+(?:\.\d+)?)%/i
    );

  if (
    winRateMatch
  ) {
    team.winRate =
      Number(
        winRateMatch[1]
      );
  }

  // ========================================================
  // RECENT FORM
  // ========================================================

  const formMatch =
    text.match(
      /Recent form\s+([WDL](?:\s+[WDL])*)/i
    );

  if (
    formMatch
  ) {
    team.recentForm =
      formMatch[1]
        .split(/\s+/)
        .filter(Boolean);
  }

  // ========================================================
  // LEADERSHIP
  // ========================================================

  const captainMatch =
    text.match(
      /Captain\s+(.+?)\s+Head Coach/i
    );

  if (
    captainMatch
  ) {
    const value =
      cleanText(
        captainMatch[1]
      );

    if (
      !/no captain assigned/i.test(
        value
      )
    ) {
      team.leadership.captain =
        value;
    }
  }

  const coachMatch =
    text.match(
      /Head Coach\s+(.+?)\s+President/i
    );

  if (
    coachMatch
  ) {
    const value =
      cleanText(
        coachMatch[1]
      );

    if (
      !/no coach assigned/i.test(
        value
      )
    ) {
      team.leadership.headCoach =
        value;
    }
  }

  const presidentMatch =
    text.match(
      /President\s+(.+?)\s+(?:Players|Coaches|Committee)/i
    );

  if (
    presidentMatch
  ) {
    const value =
      cleanText(
        presidentMatch[1]
      );

    if (
      !/no president assigned/i.test(
        value
      )
    ) {
      team.leadership.president =
        value;
    }
  }

  // ========================================================
  // SEASON STATISTICS
  // ========================================================

  const seasonMatch =
    text.match(
      /Season\s+Pos\s+(\d+)\s+Pld\s+(\d+)\s+Pts\s+(\d+)\s+GD\s+(-?\d+)\s+W\s+(\d+)\s+D\s+(\d+)\s+L\s+(\d+)\s+GF\s+(\d+)/i
    );

  if (
    seasonMatch
  ) {
    team.season = {
      position:
        Number(
          seasonMatch[1]
        ),

      played:
        Number(
          seasonMatch[2]
        ),

      points:
        Number(
          seasonMatch[3]
        ),

      goalDifference:
        Number(
          seasonMatch[4]
        ),

      wins:
        Number(
          seasonMatch[5]
        ),

      draws:
        Number(
          seasonMatch[6]
        ),

      losses:
        Number(
          seasonMatch[7]
        ),

      goalsFor:
        Number(
          seasonMatch[8]
        ),
    };
  }

  return team;
}

// ============================================================
// EXTRACT GENERIC TABLE BY HEADING
// ============================================================

function findSectionTable(
  html,
  headingPattern
) {
  const headingRegex =
    new RegExp(
      `<h[1-6][^>]*>[^<]*${headingPattern}[^<]*<\\/h[1-6]>`,
      "i"
    );

  const headingMatch =
    html.match(
      headingRegex
    );

  if (!headingMatch) {
    return [];
  }

  const start =
    headingMatch.index +
    headingMatch[0].length;

  const remaining =
    html.slice(start);

  const tableMatch =
    remaining.match(
      /<table\b[^>]*>[\s\S]*?<\/table>/i
    );

  if (!tableMatch) {
    return [];
  }

  return extractTableRows(
    tableMatch[0]
  );
}

// ============================================================
// COACHES
// ============================================================

function parseCoaches(
  html
) {
  const rows =
    findSectionTable(
      html,
      "Coaches"
    );

  return rows
    .filter(
      (cells) =>
        cells.length >= 2
    )
    .filter(
      (cells) =>
        !/name/i.test(
          cells[0]?.text
        )
    )
    .map(
      (cells) => ({
        name:
          cleanText(
            cells[0]?.text
          ),

        role:
          cleanText(
            cells[1]?.text
          ),

        photo:
          cells[0]?.image ||
          "",
      })
    )
    .filter(
      (item) =>
        item.name &&
        !/no couch staff found/i.test(
          item.name
        )
    );
}

// ============================================================
// COMMITTEE
// ============================================================

function parseCommittee(
  html
) {
  const rows =
    findSectionTable(
      html,
      "commite|committee"
    );

  return rows
    .filter(
      (cells) =>
        cells.length >= 2
    )
    .filter(
      (cells) =>
        !/name/i.test(
          cells[0]?.text
        )
    )
    .map(
      (cells) => ({
        name:
          cleanText(
            cells[0]?.text
          ),

        role:
          cleanText(
            cells[1]?.text
          ),

        photo:
          cells[0]?.image ||
          "",
      })
    )
    .filter(
      (item) =>
        item.name &&
        !/no committee members found/i.test(
          item.name
        )
    );
}

// ============================================================
// TEAM PLAYER TABLE
// ============================================================

function parseTeamPlayers(
  html
) {
  const rows =
    findSectionTable(
      html,
      "Player"
    );

  const players = [];

  for (
    const cells of rows
  ) {
    if (
      cells.length < 7
    ) {
      continue;
    }

    const number =
      parseNumber(
        cells[0]?.text
      );

    const name =
      cleanText(
        cells[2]?.text
      );

    const positionLabel =
      cleanText(
        cells[3]?.text
      );

    const goals =
      parseNumber(
        cells[4]?.text
      );

    const assists =
      parseNumber(
        cells[5]?.text
      );

    const yellowCards =
      parseNumber(
        cells[6]?.text
      );

    const redCards =
      parseNumber(
        cells[7]?.text
      );

    if (
      !name ||
      /player/i.test(
        name
      )
    ) {
      continue;
    }

    players.push({
      number,

      name,

      position:
        mapPosition(
          positionLabel
        ),

      positionLabel,

      goals,

      assists,

      yellowCards,

      redCards,

      photo:
        cells[1]?.image ||
        "",
    });
  }

  return players;
}

// ============================================================
// FIXTURES
// ============================================================

function parseFixtures(
  html
) {
  const fixtures = [];

  const sectionRegex =
    /<h[1-6][^>]*>[^<]*Fixtures\s*&\s*Results[^<]*<\/h[1-6]>/i;

  const section =
    html.match(
      sectionRegex
    );

  if (!section) {
    return fixtures;
  }

  const start =
    section.index +
    section[0].length;

  const remaining =
    html.slice(start);

  /*
   * Try normal fixture cards.
   */

  const articleMatches =
    remaining.match(
      /<(article|div|li)\b[^>]*>[\s\S]*?<\/\1>/gi
    ) || [];

  for (
    const block of articleMatches
  ) {
    const text =
      cleanText(block);

    if (
      !text ||
      !/(vs| v )/i.test(text)
    ) {
      continue;
    }

    const match =
      text.match(
        /(.+?)\s+(?:vs|v)\s+(.+?)(?=\s+(?:Upcoming|Finished|FT|Postponed|Cancelled)\b|$)/i
      );

    if (!match) {
      continue;
    }

    const home =
      cleanText(
        match[1]
      );

    const away =
      cleanText(
        match[2]
      );

    if (
      home.length > 100 ||
      away.length > 100
    ) {
      continue;
    }

    let status =
      "Upcoming";

    if (
      /finished|FT\b/i.test(
        text
      )
    ) {
      status = "Finished";
    } else if (
      /postponed/i.test(
        text
      )
    ) {
      status = "Postponed";
    } else if (
      /cancelled/i.test(
        text
      )
    ) {
      status = "Cancelled";
    }

    fixtures.push({
      homeTeam: home,

      awayTeam: away,

      status,

      raw:
        text.slice(
          0,
          500
        ),
    });
  }

  /*
   * Deduplicate fixtures.
   */

  const seen =
    new Set();

  return fixtures.filter(
    (fixture) => {
      const key = [
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.status,
      ]
        .join("::")
        .toLowerCase();

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

// ============================================================
// TOP SCORERS / ASSISTS
// ============================================================

function parseSimpleRanking(
  html,
  headingPattern
) {
  const rows =
    findSectionTable(
      html,
      headingPattern
    );

  return rows
    .filter(
      (cells) =>
        cells.length >= 2
    )
    .filter(
      (cells) =>
        !/player|name/i.test(
          cells[0]?.text
        )
    )
    .map(
      (cells) => ({
        player:
          cleanText(
            cells[0]?.text
          ),

        value:
          parseNumber(
            cells[cells.length - 1]
              ?.text
          ),

        image:
          cells[0]?.image ||
          "",
      })
    )
    .filter(
      (item) =>
        item.player
    );
}

// ============================================================
// LATEST NEWS
// ============================================================

function parseLatestNews(
  html
) {
  const news = [];

  const sectionRegex =
    /<h[1-6][^>]*>[^<]*Latest News[^<]*<\/h[1-6]>/i;

  const section =
    html.match(
      sectionRegex
    );

  if (!section) {
    return news;
  }

  const remaining =
    html.slice(
      section.index +
        section[0].length
    );

  const blocks =
    remaining.match(
      /<(article|li|div)\b[^>]*>[\s\S]*?<\/\1>/gi
    ) || [];

  for (
    const block of blocks
  ) {
    const text =
      cleanText(block);

    if (
      !text ||
      text.length < 10
    ) {
      continue;
    }

    const dateMatch =
      text.match(
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/i
      );

    const date =
      dateMatch
        ? dateMatch[0]
        : "";

    const title =
      date
        ? cleanText(
            text.replace(
              date,
              ""
            )
          )
        : text;

    if (
      title.length > 300
    ) {
      continue;
    }

    news.push({
      date,

      title,
    });
  }

  const seen =
    new Set();

  return news.filter(
    (item) => {
      const key =
        `${item.date}::${item.title}`
          .toLowerCase();

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

// ============================================================
// FETCH HTML
// ============================================================

async function fetchHtml(
  url
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            Accept:
              "text/html,application/xhtml+xml",

            "User-Agent":
              USER_AGENT,

            "Accept-Language":
              "en-US,en;q=0.9",
          },

          signal:
            controller.signal,
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `${url} returned HTTP ${response.status}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(
      timeout
    );
  }
}

// ============================================================
// FETCH PLAYER PAGES
// ============================================================

async function fetchPlayerPages() {
  const allPlayers = [];

  const BATCH_SIZE = 5;

  for (
    let start = 1;
    start <=
    MAX_PLAYER_PAGES;
    start += BATCH_SIZE
  ) {
    const pages = [];

    for (
      let page = start;
      page <
      Math.min(
        start + BATCH_SIZE,
        MAX_PLAYER_PAGES + 1
      );
      page++
    ) {
      pages.push(page);
    }

    const results =
      await Promise.allSettled(
        pages.map(
          (page) =>
            fetchHtml(
              page === 1
                ? RPL_PLAYERS_URL
                : `${RPL_PLAYERS_URL}?page=${page}`
            )
        )
      );

    for (
      let index = 0;
      index < results.length;
      index++
    ) {
      const result =
        results[index];

      if (
        result.status !==
        "fulfilled"
      ) {
        console.error(
          `Failed RPL player page ${pages[index]}:`,
          result.reason
        );

        continue;
      }

      const players =
        parsePlayersFromHtml(
          result.value
        );

      allPlayers.push(
        ...players
      );
    }
  }

  const seen =
    new Set();

  return allPlayers.filter(
    (player) => {
      const key = [
        player.name,
        player.clubName,
        player.nationality,
      ]
        .map(
          (value) =>
            cleanText(
              value
            )
              .toLowerCase()
        )
        .join("::");

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

// ============================================================
// MERGE PLAYERS INTO TEAMS
// ============================================================

function attachPlayersToTeams(
  teams,
  allPlayers
) {
  return teams.map(
    (team) => {
      const teamPlayers =
        allPlayers.filter(
          (player) =>
            normalizeClubName(
              player.clubName
            ) ===
            normalizeClubName(
              team.name
            )
        );

      /*
       * The team page has richer
       * statistics than the general
       * player directory, so keep both.
       */

      return {
        ...team,

        directoryPlayers:
          teamPlayers,
      };
    }
  );
}

// ============================================================
// CLUB NAME NORMALIZATION
// ============================================================

function normalizeClubName(
  value = ""
) {
  return cleanText(value)
    .toLowerCase()
    .replace(
      /\bfootball club\b/g,
      ""
    )
    .replace(
      /\bfc\b/g,
      ""
    )
    .replace(
      /\bsc\b/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

// ============================================================
// GET TEAM URL
//
// Some sites put the team ID/slug
// in option value. We support:
//   /info/team?team=ID
//   /info/team?club=ID
//   /info/team/slug
// ============================================================

function buildTeamUrls(
  team
) {
  const urls = [];

  if (
    team.value
  ) {
    urls.push(
      `${RPL_TEAM_URL}?team=${encodeURIComponent(team.value)}`
    );

    urls.push(
      `${RPL_TEAM_URL}?club=${encodeURIComponent(team.value)}`
    );

    urls.push(
      `${RPL_TEAM_URL}?clubId=${encodeURIComponent(team.value)}`
    );
  }

  const slug =
    team.name
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );

  if (slug) {
    urls.push(
      `${RPL_TEAM_URL}/${slug}`
    );
  }

  return [
    ...new Set(urls),
  ];
}

// ============================================================
// FIND THE CORRECT TEAM PAGE
// ============================================================

async function fetchTeamPage(
  team
) {
  /*
   * First try URLs generated from
   * the actual selector value.
   */

  const urls =
    buildTeamUrls(team);

  for (
    const url of urls
  ) {
    try {
      const html =
        await fetchHtml(
          url
        );

      const pageText =
        cleanText(html);

      /*
       * We consider it a useful
       * team page if the team name
       * appears in it.
       */

      if (
        pageText
          .toLowerCase()
          .includes(
            team.name
              .toLowerCase()
          )
      ) {
        return {
          url,
          html,
        };
      }
    } catch {
      /*
       * Try next candidate.
       */
    }
  }

  /*
   * If the site uses a client-side
   * selector and all values point to
   * the same page, return the main page.
   *
   * The browser-rendered site can still
   * expose the selected data, but a plain
   * server fetch cannot execute React JS.
   */

  try {
    const html =
      await fetchHtml(
        RPL_TEAM_URL
      );

    return {
      url:
        RPL_TEAM_URL,

      html,
    };
  } catch {
    return null;
  }
}

// ============================================================
// BUILD TEAM DATA
// ============================================================

async function scrapeTeam(
  team,
  players
) {
  const page =
    await fetchTeamPage(
      team
    );

  if (!page) {
    return {
      name:
        team.name,

      value:
        team.value,

      sourceUrl:
        "",

      error:
        "Unable to load team page.",

      logo:
        "",

      established:
        "",

      rank: 0,

      rankLabel:
        "",

      squadSize: 0,

      winRate: 0,

      recentForm: [],

      email:
        "",

      phone:
        "",

      leadership: {
        captain: "",
        headCoach: "",
        president: "",
      },

      players: players.filter(
        (player) =>
          normalizeClubName(
            player.clubName
          ) ===
          normalizeClubName(
            team.name
          )
      ),

      coaches: [],

      committee: [],

      season: {
        position: 0,
        played: 0,
        points: 0,
        goalDifference: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
      },

      fixtures: [],

      topScorers: [],

      topAssists: [],

      latestNews: [],
    };
  }

  const profile =
    extractTeamProfile(
      page.html,
      team.name
    );

  const teamPlayers =
    parseTeamPlayers(
      page.html
    );

  const directoryPlayers =
    players.filter(
      (player) =>
        normalizeClubName(
          player.clubName
        ) ===
        normalizeClubName(
          team.name
        )
    );

  /*
   * Prefer the richer team-page
   * player information.
   */

  const mergedPlayers =
    teamPlayers.length > 0
      ? teamPlayers.map(
          (player) => {
            const directory =
              directoryPlayers.find(
                (item) =>
                  normalizeClubName(
                    item.name
                  ) ===
                  normalizeClubName(
                    player.name
                  )
              );

            return {
              ...directory,
              ...player,
            };
          }
        )
      : directoryPlayers;

  return {
    name:
      profile.name ||
      team.name,

    value:
      team.value,

    sourceUrl:
      page.url,

    logo:
      profile.logo,

    established:
      profile.established,

    rank:
      profile.rank,

    rankLabel:
      profile.rankLabel,

    squadSize:
      profile.squadSize ||
      mergedPlayers.length,

    winRate:
      profile.winRate,

    recentForm:
      profile.recentForm,

    email:
      profile.email,

    phone:
      profile.phone,

    leadership:
      profile.leadership,

    players:
      mergedPlayers,

    coaches:
      parseCoaches(
        page.html
      ),

    committee:
      parseCommittee(
        page.html
      ),

    season:
      profile.season,

    fixtures:
      parseFixtures(
        page.html
      ),

    topScorers:
      parseSimpleRanking(
        page.html,
        "Top Scorers"
      ),

    topAssists:
      parseSimpleRanking(
        page.html,
        "Top Assists"
      ),

    latestNews:
      parseLatestNews(
        page.html
      ),
  };
}

// ============================================================
// API HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return res.status(405).json({
      success: false,

      message:
        "Method not allowed.",
    });
  }

  try {
    /*
     * --------------------------------------------------------
     * 1. Load Team Management page
     * --------------------------------------------------------
     */

    const teamHtml =
      await fetchHtml(
        RPL_TEAM_URL
      );

    /*
     * --------------------------------------------------------
     * 2. Discover teams dynamically
     * --------------------------------------------------------
     */

    const discoveredTeams =
      extractTeamOptions(
        teamHtml
      );

    /*
     * --------------------------------------------------------
     * 3. Load all players
     * --------------------------------------------------------
     */

    const allPlayers =
      await fetchPlayerPages();

    /*
     * --------------------------------------------------------
     * 4. If team selector could not
     *    be parsed, derive clubs from
     *    player directory.
     * --------------------------------------------------------
     */

    let teams =
      discoveredTeams;

    if (
      teams.length === 0
    ) {
      const clubMap =
        new Map();

      for (
        const player of allPlayers
      ) {
        const name =
          cleanText(
            player.clubName
          );

        if (
          !name
        ) {
          continue;
        }

        const key =
          normalizeClubName(
            name
          );

        if (
          !clubMap.has(
            key
          )
        ) {
          clubMap.set(
            key,
            {
              name,
              value: "",
            }
          );
        }
      }

      teams =
        Array.from(
          clubMap.values()
        );
    }

    /*
     * --------------------------------------------------------
     * 5. Scrape each team.
     *
     * Small batches prevent sending
     * a ridiculous number of requests
     * at once.
     * --------------------------------------------------------
     */

    const scrapedTeams = [];

    const TEAM_BATCH_SIZE = 3;

    for (
      let start = 0;
      start <
      teams.length;
      start +=
        TEAM_BATCH_SIZE
    ) {
      const batch =
        teams.slice(
          start,
          start +
            TEAM_BATCH_SIZE
        );

      const results =
        await Promise.all(
          batch.map(
            (team) =>
              scrapeTeam(
                team,
                allPlayers
              )
          )
        );

      scrapedTeams.push(
        ...results
      );
    }

    /*
     * --------------------------------------------------------
     * 6. Deduplicate teams
     * --------------------------------------------------------
     */

    const seenTeams =
      new Set();

    const uniqueTeams =
      scrapedTeams.filter(
        (team) => {
          const key =
            normalizeClubName(
              team.name
            );

          if (
            !key ||
            seenTeams.has(
              key
            )
          ) {
            return false;
          }

          seenTeams.add(
            key
          );

          return true;
        }
      );

    /*
     * --------------------------------------------------------
     * RESPONSE
     * --------------------------------------------------------
     */

    return res.status(200).json({
      success: true,

      source: {
        teams:
          RPL_TEAM_URL,

        players:
          RPL_PLAYERS_URL,
      },

      season:
        "2026/2027",

      teams:
        uniqueTeams,

      teamCount:
        uniqueTeams.length,

      players:
        allPlayers,

      playerCount:
        allPlayers.length,

      fetchedPlayerPages:
        MAX_PLAYER_PAGES,

      fetchedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "RPL scraper error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        error?.message ||
        "Unable to fetch Rwanda Premier League data.",

      source:
        RPL_TEAM_URL,
    });
  }
}
