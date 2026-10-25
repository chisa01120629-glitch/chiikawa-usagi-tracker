const ALLOWED_ORIGIN = "https://chisa01120629-glitch.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Passphrase",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

function requireAuth(request, env) {
  const given = request.headers.get("X-Passphrase") || "";
  if (!env.WRITE_PASSPHRASE || given !== env.WRITE_PASSPHRASE) {
    return json({ error: "合言葉が正しくありません" }, 401);
  }
  return null;
}

// photo is stored directly as a data: URL string in the photo_key column (no R2 needed).
// Frontend already resizes/compresses images before sending, so rows stay small.
const MAX_PHOTO_BYTES = 1_500_000; // ~1.5MB safety cap on the stored data URL string

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // GET /api/state - everyone can read
      if (pathname === "/api/state" && method === "GET") {
        const itemRows = await env.DB.prepare("SELECT * FROM item_state").all();
        const customRows = await env.DB.prepare("SELECT * FROM custom_items").all();

        const itemStates = {};
        for (const row of itemRows.results) {
          itemStates[row.id] = {
            owned: !!row.owned,
            memo: row.memo || "",
            photo: row.photo_key || null,
          };
        }
        const customItems = customRows.results.map((row) => ({
          id: row.id,
          prefCode: row.pref_code,
          motif: row.motif,
          owned: !!row.owned,
          memo: row.memo || "",
          photo: row.photo_key || null,
          refLink: row.ref_link,
          custom: true,
        }));
        return json({ itemStates, customItems });
      }

      // PUT /api/items/:id - update owned/memo (auth required)
      if (pathname.startsWith("/api/items/") && method === "PUT") {
        const authErr = requireAuth(request, env);
        if (authErr) return authErr;
        const id = decodeURIComponent(pathname.slice("/api/items/".length));
        const body = await request.json();
        const owned = body.owned ? 1 : 0;
        const memo = typeof body.memo === "string" ? body.memo : "";
        await env.DB.prepare(
          `INSERT INTO item_state (id, owned, memo, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET owned=excluded.owned, memo=excluded.memo, updated_at=excluded.updated_at`
        ).bind(id, owned, memo).run();

        await env.DB.prepare(
          `UPDATE custom_items SET owned=?, memo=? WHERE id=?`
        ).bind(owned, memo, id).run();

        return json({ ok: true });
      }

      // POST /api/custom - add a custom item (auth required)
      if (pathname === "/api/custom" && method === "POST") {
        const authErr = requireAuth(request, env);
        if (authErr) return authErr;
        const body = await request.json();
        const prefCode = body.prefCode;
        const motif = (body.motif || "").trim();
        const refLink = body.refLink || null;
        if (!prefCode || !motif) return json({ error: "prefCode と motif が必要です" }, 400);
        const id = "custom-" + prefCode + "-" + Date.now();
        await env.DB.prepare(
          `INSERT INTO custom_items (id, pref_code, motif, owned, memo, ref_link, created_at)
           VALUES (?, ?, ?, 0, '', ?, datetime('now'))`
        ).bind(id, prefCode, motif, refLink).run();
        return json({ id, prefCode, motif, owned: false, memo: "", photo: null, refLink, custom: true });
      }

      // DELETE /api/custom/:id (auth required)
      if (pathname.startsWith("/api/custom/") && method === "DELETE") {
        const authErr = requireAuth(request, env);
        if (authErr) return authErr;
        const id = decodeURIComponent(pathname.slice("/api/custom/".length));
        await env.DB.prepare("DELETE FROM custom_items WHERE id=?").bind(id).run();
        await env.DB.prepare("DELETE FROM item_state WHERE id=?").bind(id).run();
        return json({ ok: true });
      }

      // POST /api/photo/:id - save a photo as a data URL string (auth required)
      if (pathname.startsWith("/api/photo/") && method === "POST") {
        const authErr = requireAuth(request, env);
        if (authErr) return authErr;
        const id = decodeURIComponent(pathname.slice("/api/photo/".length));
        const body = await request.json();
        const dataUrl = body.dataUrl;
        if (!dataUrl || !dataUrl.startsWith("data:image/")) {
          return json({ error: "画像データが不正です" }, 400);
        }
        if (dataUrl.length > MAX_PHOTO_BYTES) {
          return json({ error: "画像が大きすぎます" }, 400);
        }

        await env.DB.prepare(
          `INSERT INTO item_state (id, owned, memo, photo_key, updated_at)
           VALUES (?, 0, '', ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET photo_key=excluded.photo_key, updated_at=excluded.updated_at`
        ).bind(id, dataUrl).run();
        await env.DB.prepare(`UPDATE custom_items SET photo_key=? WHERE id=?`).bind(dataUrl, id).run();

        return json({ ok: true, photo: dataUrl });
      }

      // DELETE /api/photo/:id (auth required)
      if (pathname.startsWith("/api/photo/") && method === "DELETE") {
        const authErr = requireAuth(request, env);
        if (authErr) return authErr;
        const id = decodeURIComponent(pathname.slice("/api/photo/".length));
        await env.DB.prepare(`UPDATE item_state SET photo_key=NULL WHERE id=?`).bind(id).run();
        await env.DB.prepare(`UPDATE custom_items SET photo_key=NULL WHERE id=?`).bind(id).run();
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
