// netlify/functions/leaderboard.js
// This function will fetch your published-to-web Google Sheet CSV
// and return clean JSON for your chart.

export async function handler() {
  const CSV_URL = process.env.CSV_URL;
  if (!CSV_URL) {
    return json(500, { error: "Missing CSV_URL env var (set it in Netlify → Site settings → Environment variables)" });
  }

  try {
    const r = await fetch(CSV_URL, { cache: "no-store" });
    const text = await r.text();

    if (!r.ok) return json(502, { error: `Upstream ${r.status} ${r.statusText}` });

    const sniff = text.slice(0, 200).trim().toLowerCase();
    if (sniff.startsWith("<!doctype") || sniff.startsWith("<html")) {
      return json(500, { error: "Expected CSV but got HTML. Make sure your Sheet is 'Publish to web' → CSV and the correct tab." });
    }

    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    const headers = splitCSVLine(lines[0]).map(h => h.trim());
    const norm = headers.map(h => h.toLowerCase());
    if (!norm.includes("year")) return json(500, { error: `Header must include 'Year'. Got: ${headers.join(", ")}` });

    const rows = lines.slice(1).map(ln => {
      const cols = splitCSVLine(ln);
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] ?? "");

      const pick = (...cands) => {
        for (const c of cands) if (obj[c] != null && obj[c] !== "") return obj[c];
        const table = {};
        Object.keys(obj).forEach(k => table[k.toLowerCase().replace(/[^a-z0-9]/g, "")] = obj[k]);
        for (const c of cands) {
          const k = c.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (k in table) return table[k];
        }
        return "";
      };

      const year = Number(pick("Year", "year"));
      if (!Number.isFinite(year)) return null;

      return {
        year,
        totalGifts: parseNumber(pick("totalGifts","Total Gifts","total_gifts","Total Raised","Amount","Total","Total $")),
        percentGivers: parseNumber(pick("percentGivers","Percent of Givers","% Givers","Percent Givers")),
        percentRecurring: parseNumber(pick("percentRecurring","% Recurring","Recurring %","Pct Recurring")),
        percentRecurringByGifts: parseNumber(pick("percentRecurringByGifts","% Recurring by Gifts","Recurring % by Gifts","Pct Recurring by Gifts")),
      };
    }).filter(Boolean);

    // small cache to reduce sheet traffic
    return json(200, { rows }, { "Cache-Control": "public, max-age=60" });

  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function splitCSVLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else { q = !q; }
    } else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}

function parseNumber(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9+\-\.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}
