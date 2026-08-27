import { URL } from "url";

const RPL_BASE_URL =
  "https://rwandapremierleague.rw/players";

const MAX_PAGES = 59;

const REQUEST_TIMEOUT = 20000;

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);

      return Number.isFinite(n)
        ? String.fromCharCode(n)
        : _;
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
        /<[^>]+>/g,
        " "
      )
  );
}

function cleanName(value = "") {
  return stripHtml(value)
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value) {
  if (!value) {
    return "";
  }

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
  const regex =
    new RegExp(
      `${attribute}\\s*=\\s*["']([^"']+)["']`,
      "i"
    );

  const match =
    String(tag).match(regex);

  return match
    ? decodeHtml(match[1])
    : "";
}

function extractImage(tag) {
  return (
    extractAttribute(
      tag,
      "src"
    ) ||
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

function mapPosition(
  value
) {
  const position =
    cleanName(value)
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

function extractTableRows(html) {
  return (
    String(html).match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    ) || []
  );
}

function extractCells(rowHtml) {
  return (
    rowHtml.match(
      /<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi
    ) || []
  );
}

function parsePlayersFromHtml(
  html
) {
  const players = [];

  const rows =
    extractTableRows(
      html
    );

  for (
    const rowHtml of rows
  ) {
    const cells =
      extractCells(
        rowHtml
      );

    if (
      cells.length < 4
    ) {
      continue;
    }

    const parsed =
      cells.map(
        (cell) => {
          const imageTag =
            cell.match(
              /<img\b[^>]*>/i
            );

          return {
            text:
              cleanName(
                cell
              ),

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

    const first =
      parsed[0]?.text || "";

    if (
      /^(player|rank|#|name)$/i.test(
        first
      )
    ) {
      continue;
    }

    const name =
      parsed[0]?.text || "";

    const club =
      parsed[1]?.text || "";

    const position =
      parsed[2]?.text || "";

    const nationality =
      parsed[3]?.text || "";

    if (
      !name ||
      !club
    ) {
      continue;
    }

    if (
      name.length > 120 ||
      club.length > 120
    ) {
      continue;
    }

    players.push({
      name,

      clubName:
        club,

      position:
        mapPosition(
          position
        ),

      positionLabel:
        position,

      nationality,

      photo:
        parsed[0]?.image ||
        "",

      clubLogo:
        parsed[1]?.image ||
        "",
    });
  }

  return players;
}

async function fetchPage(
  page
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      REQUEST_TIMEOUT
    );

  try {
    const url =
      page === 1
        ? RPL_BASE_URL
        : `${RPL_BASE_URL}?page=${page}`;

    const response =
      await fetch(
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
        `RPL page ${page} returned HTTP ${response.status}`
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
  if (
    req.method !==
    "GET"
  ) {
    return res.status(405).json({
      success: false,
      message:
        "Method not allowed.",
    });
  }

  try {
    const allPlayers = [];

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
            start +
              BATCH_SIZE,
            MAX_PAGES + 1
          );
        page++
      ) {
        pages.push(page);
      }

      const results =
        await Promise.allSettled(
          pages.map(
            fetchPage
          )
        );

      for (
        let i = 0;
        i < results.length;
        i++
      ) {
        const result =
          results[i];

        if (
          result.status !==
          "fulfilled"
        ) {
          console.error(
            `RPL page ${pages[i]} failed:`,
            result.reason
          );

          continue;
        }

        allPlayers.push(
          ...parsePlayersFromHtml(
            result.value
          )
        );
      }
    }

    const seen =
      new Set();

    const uniquePlayers =
      allPlayers.filter(
        (player) => {
          const key =
            `${player.name
              .toLowerCase()
              .replace(
                /\s+/g,
                " "
              )
              .trim()}::${player.clubName
              .toLowerCase()
              .replace(
                /\s+/g,
                " "
              )
              .trim()}`;

          if (
            seen.has(key)
          ) {
            return false;
          }

          seen.add(key);

          return true;
        }
      );

    return res.status(200).json({
      success: true,

      source:
        RPL_BASE_URL,

      players:
        uniquePlayers,

      count:
        uniquePlayers.length,

      fetchedPages:
        MAX_PAGES,
    });
  } catch (error) {
    console.error(
      "RPL players API error:",
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
