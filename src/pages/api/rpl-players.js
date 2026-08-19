import { URL } from "url";

const RPL_BASE_URL =
  "https://rwandapremierleague.rw/players";

const MAX_PAGES = 59;

const REQUEST_TIMEOUT = 20000;

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(
          Number(code)
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
      .replace(/<[^>]+>/g, " ")
  ).trim();
}

function absoluteUrl(value) {
  if (!value) return "";

  try {
    return new URL(
      value,
      RPL_BASE_URL
    ).toString();
  } catch {
    return value;
  }
}

function extractAttribute(
  tag,
  attribute
) {
  const regex = new RegExp(
    `${attribute}\\s*=\\s*["']([^"']+)["']`,
    "i"
  );

  const match = String(tag).match(regex);

  return match
    ? decodeHtml(match[1])
    : "";
}

function extractImage(tag) {
  return (
    extractAttribute(tag, "src") ||
    extractAttribute(tag, "data-src") ||
    extractAttribute(tag, "data-lazy-src") ||
    ""
  );
}

function cleanName(value) {
  return stripHtml(value)
    .replace(/\s+/g, " ")
    .trim();
}

function mapPosition(value) {
  const position = cleanName(value)
    .toLowerCase();

  if (
    position.includes("goalkeeper") ||
    position.includes("keeper")
  ) {
    return "GK";
  }

  if (
    position.includes("defender") ||
    position.includes("defence") ||
    position.includes("defense")
  ) {
    return "DEF";
  }

  if (
    position.includes("midfielder") ||
    position.includes("midfield")
  ) {
    return "MID";
  }

  if (
    position.includes("forward") ||
    position.includes("striker") ||
    position.includes("attacker")
  ) {
    return "FWD";
  }

  return "MID";
}

/*
 * Find rows from normal HTML tables.
 *
 * Expected structure:
 *
 * <tr>
 *   <td>PLAYER</td>
 *   <td>CLUB</td>
 *   <td>POSITION</td>
 *   <td>NATIONALITY</td>
 * </tr>
 */

function extractTableRows(html) {
  const rows = [];

  const rowMatches = String(html).match(
    /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
  );

  if (!rowMatches) {
    return rows;
  }

  for (const rowHtml of rowMatches) {
    const cellMatches = rowHtml.match(
      /<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi
    );

    if (!cellMatches) continue;

    const cells = cellMatches.map(
      (cell) => {
        const imageTag = cell.match(
          /<img\b[^>]*>/i
        );

        return {
          text: cleanName(cell),
          image: imageTag
            ? absoluteUrl(
                extractImage(
                  imageTag[0]
                )
              )
            : "",
        };
      }
    );

    if (cells.length < 4) {
      continue;
    }

    const firstCell = cells[0].text
      .toLowerCase();

    /*
     * Ignore table headings.
     */

    if (
      firstCell === "player" ||
      firstCell === "#" ||
      firstCell === "rank"
    ) {
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

function parsePlayersFromHtml(html) {
  const players = [];

  const rows = extractTableRows(html);

  for (const cells of rows) {
    const name = cleanName(
      cells[0]?.text
    );

    const club = cleanName(
      cells[1]?.text
    );

    const position = cleanName(
      cells[2]?.text
    );

    const nationality = cleanName(
      cells[3]?.text
    );

    if (!name || !club) {
      continue;
    }

    /*
     * Ignore pagination / unrelated tables.
     */

    if (
      name.length > 120 ||
      club.length > 100
    ) {
      continue;
    }

    players.push({
      name,

      clubName: club,

      position:
        mapPosition(position),

      positionLabel:
        position,

      nationality,

      photo:
        cells[0]?.image || "",

      clubLogo:
        cells[1]?.image || "",
    });
  }

  return players;
}

async function fetchPage(page) {
  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT);

  try {
    const url =
      page === 1
        ? RPL_BASE_URL
        : `${RPL_BASE_URL}?page=${page}`;

    const response = await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept:
            "text/html,application/xhtml+xml",

          "User-Agent":
            "Mozilla/5.0 (compatible; VirtualFootballManager/1.0)",
        },

        signal:
          controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(
        `RPL page ${page} returned ${response.status}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed.",
    });
  }

  try {
    const allPlayers = [];

    /*
     * Fetch pages in small batches so we do not
     * hammer the RPL server with 59 simultaneous
     * requests. Humanity survives another day.
     */

    const BATCH_SIZE = 5;

    for (
      let start = 1;
      start <= MAX_PAGES;
      start += BATCH_SIZE
    ) {
      const pages = [];

      for (
        let page = start;
        page <
          Math.min(
            start + BATCH_SIZE,
            MAX_PAGES + 1
          );
        page++
      ) {
        pages.push(page);
      }

      const results =
        await Promise.allSettled(
          pages.map(fetchPage)
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
            `Failed RPL page ${pages[index]}:`,
            result.reason
          );

          continue;
        }

        const pagePlayers =
          parsePlayersFromHtml(
            result.value
          );

        allPlayers.push(
          ...pagePlayers
        );
      }
    }

    /*
     * Deduplicate the source itself.
     */

    const seen = new Set();

    const uniquePlayers =
      allPlayers.filter((player) => {
        const key = [
          player.name
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim(),

          player.clubName
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim(),
        ].join("::");

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);

        return true;
      });

    return res.status(200).json({
      success: true,

      source:
        "https://rwandapremierleague.rw/players",

      players:
        uniquePlayers,

      count:
        uniquePlayers.length,

      fetchedPages:
        MAX_PAGES,
    });
  } catch (error) {
    console.error(
      "RPL API error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        error?.message ||
        "Unable to fetch Rwanda Premier League players.",
    });
  }
}
