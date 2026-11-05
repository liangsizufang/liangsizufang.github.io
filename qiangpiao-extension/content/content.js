/**
 * qiangpiao content script — Ticketmaster US page assist.
 *
 * Compliant boundaries (do NOT cross):
 * - No queue jump / queue automation
 * - No CAPTCHA solving
 * - No rate-limit bypass / multi-account / proxies
 * - Never auto-submit payment / place order
 *
 * What we do:
 * - Show prefs panel (qty, section/price notes)
 * - Persist watch-list entry for this event
 * - Best-effort set quantity / filter inputs the page exposes
 * - Scroll to / highlight Find Tickets / checkout controls
 * - Leave queue, CAPTCHA, and Pay to the user
 */
(function () {
  const S = globalThis.QiangpiaoStorage;
  if (!S) return;

  const ROOT_ID = "qiangpiao-root";
  const HIGHLIGHT_CLASS = "qiangpiao-highlight";

  /** @type {any} */
  let currentEvent = null;
  let statusTimer = null;

  function isLikelyEventPage() {
    const path = location.pathname.toLowerCase();
    if (path.includes("/event/")) return true;
    // Artist/event SEO URLs often end with an event id segment
    if (S.extractEventId(location.href)) return true;
    // Ticket selection / edp flows
    if (/\/(event|tickets|edp)\//i.test(path)) return true;
    return false;
  }

  function pageTitleLabel() {
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent) {
      return h1.textContent.trim().slice(0, 120);
    }
    return document.title.replace(/\s*\|\s*Ticketmaster.*$/i, "").trim();
  }

  async function ensureEventRecord() {
    const existing = await S.findWatchedEvent(location.href);
    if (existing) {
      currentEvent = existing;
      return existing;
    }
    const created = S.createWatchedEvent({
      url: location.href.split("#")[0],
      label: pageTitleLabel() || undefined,
    });
    // Do not auto-add until user saves / watches
    currentEvent = created;
    return created;
  }

  function clearHighlights() {
    document.querySelectorAll("." + HIGHLIGHT_CLASS).forEach((el) => {
      el.classList.remove(HIGHLIGHT_CLASS);
    });
  }

  function highlight(el) {
    if (!el) return;
    el.classList.add(HIGHLIGHT_CLASS);
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      el.scrollIntoView(true);
    }
  }

  function textOf(el) {
    return (el && (el.innerText || el.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function visible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /**
   * Find interactive controls by accessible / visible text.
   * Conservative: only click / focus clearly labeled ticket-flow controls.
   */
  function findControlsByText(patterns, selector) {
    const nodes = Array.from(document.querySelectorAll(selector));
    return nodes.filter((el) => {
      if (!visible(el)) return false;
      const t = textOf(el).toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const joined = t + " " + aria;
      return patterns.some((re) => re.test(joined));
    });
  }

  function setNativeValue(input, value) {
    const proto =
      input instanceof HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Best-effort quantity fill. Ticketmaster DOM changes often; try common patterns.
   */
  function applyQuantity(qty) {
    const results = [];
    const q = String(qty);

    // Native <select> whose label/nearby text mentions quantity/tickets
    document.querySelectorAll("select").forEach((sel) => {
      if (!visible(sel)) return;
      const ctx = (
        (sel.getAttribute("aria-label") || "") +
        " " +
        (sel.name || "") +
        " " +
        (sel.id || "") +
        " " +
        textOf(sel.closest("label, [class*='quantity'], [class*='Quantity'], [data-testid*='quantity']"))
      ).toLowerCase();
      if (!/(qty|quantity|ticket)/i.test(ctx) && !/(qty|quantity|ticket)/i.test(sel.name || "")) {
        // still accept selects that only contain numeric ticket counts 1..N
        const opts = Array.from(sel.options).map((o) => o.value);
        const numeric = opts.filter((v) => /^\d+$/.test(v));
        if (numeric.length < 2 || numeric.length !== opts.length) return;
      }
      const opt = Array.from(sel.options).find(
        (o) => o.value === q || o.textContent.trim() === q
      );
      if (opt) {
        setNativeValue(sel, opt.value);
        highlight(sel);
        results.push("Set quantity select → " + q);
      }
    });

    // Number inputs
    document.querySelectorAll('input[type="number"], input[inputmode="numeric"]').forEach((input) => {
      if (!visible(input)) return;
      const ctx = (
        (input.getAttribute("aria-label") || "") +
        " " +
        (input.name || "") +
        " " +
        (input.id || "") +
        " " +
        textOf(input.closest("label, [class*='quantity'], [class*='Quantity']"))
      ).toLowerCase();
      if (!/(qty|quantity|ticket)/i.test(ctx) && results.length > 0) return;
      if (/(qty|quantity|ticket)/i.test(ctx) || results.length === 0) {
        setNativeValue(input, q);
        highlight(input);
        results.push("Set quantity input → " + q);
      }
    });

    // Increment buttons: click until value matches (capped)
    if (results.length === 0) {
      const plus = findControlsByText(
        [/increase/, /\+/, /add ticket/],
        "button, [role='button']"
      )[0];
      const minus = findControlsByText(
        [/decrease/, /−|–|-/, /remove ticket/],
        "button, [role='button']"
      )[0];
      // Only note presence; do not spam-click blindly without a readable value
      if (plus || minus) {
        results.push(
          "Found quantity steppers — adjust manually if auto-set did not apply"
        );
        if (plus) highlight(plus);
      }
    }

    return results;
  }

  /**
   * Surface preferred section / price filters. Highlight matching UI; do not force-buy.
   */
  function applySeatAssist(sectionNotes, priceNotes) {
    const results = [];
    const tokens = String(sectionNotes || "")
      .split(/[,;/|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const priceTokens = String(priceNotes || "")
      .split(/[,;/|]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const candidates = Array.from(
      document.querySelectorAll(
        "button, a, [role='button'], [role='option'], label, li, [data-tid], [class*='section'], [class*='Section'], [class*='filter'], [class*='Filter'], [class*='price'], [class*='Price']"
      )
    ).filter(visible);

    function matchAndHighlight(list, kind) {
      let hits = 0;
      list.forEach((token) => {
        const re = new RegExp(
          token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
        candidates.forEach((el) => {
          const t = textOf(el);
          if (t.length > 80) return;
          if (re.test(t) || re.test(el.getAttribute("aria-label") || "")) {
            highlight(el);
            hits += 1;
          }
        });
      });
      if (hits > 0) results.push("Highlighted " + hits + " " + kind + " match(es)");
      else if (list.length) results.push("No on-page " + kind + " matches yet — keep notes visible");
    }

    matchAndHighlight(tokens, "section");
    matchAndHighlight(priceTokens, "price");

    // Filter / search inputs
    document
      .querySelectorAll(
        'input[type="search"], input[type="text"], input[placeholder]'
      )
      .forEach((input) => {
        if (!visible(input)) return;
        const ph = (
          (input.getAttribute("placeholder") || "") +
          " " +
          (input.getAttribute("aria-label") || "") +
          " " +
          (input.name || "")
        ).toLowerCase();
        if (!/(section|filter|search|price|seat)/i.test(ph)) return;
        if (tokens[0] && /section|seat|filter|search/i.test(ph)) {
          setNativeValue(input, tokens[0]);
          highlight(input);
          results.push("Filled filter with “" + tokens[0] + "”");
        }
      });

    return results;
  }

  /**
   * Navigate as far toward ticket selection / checkout as the page allows
   * WITHOUT submitting payment or bypassing protections.
   */
  function advanceTowardCheckout() {
    const notes = [];

    // Never click anything that looks like pay / place order / submit payment
    const forbidden =
      /(place order|pay now|submit payment|buy now pay|confirm purchase|complete purchase|apple pay|google pay|paypal)/i;

    const findPatterns = [
      /find tickets/,
      /get tickets/,
      /search for tickets/,
      /continue/,
      /next/,
      /add to cart/,
      /checkout/,
      /choose seats/,
      /select tickets/,
      /see tickets/,
    ];

    const controls = findControlsByText(
      findPatterns,
      "button, a, [role='button'], input[type='button'], input[type='submit']"
    ).filter((el) => !forbidden.test(textOf(el) + " " + (el.getAttribute("aria-label") || "")));

    // Prefer "Find tickets" / "Get tickets" over generic Continue
    controls.sort((a, b) => {
      const score = (el) => {
        const t = textOf(el).toLowerCase();
        if (/find tickets|get tickets|see tickets/.test(t)) return 0;
        if (/add to cart|checkout|select tickets|choose seats/.test(t)) return 1;
        return 2;
      };
      return score(a) - score(b);
    });

    const target = controls[0];
    if (!target) {
      notes.push(
        "No safe Find Tickets / Continue control found. Complete queue/CAPTCHA if shown, then retry."
      );
      // Highlight any visible queue/captcha messaging for awareness (no interaction)
      const blockers = findControlsByText(
        [/queue/, /waiting room/, /captcha/, /verify you are human/, /are you a human/],
        "h1, h2, h3, p, div, span, button"
      );
      if (blockers[0]) {
        highlight(blockers[0]);
        notes.push("Protection UI detected — finish it yourself (extension will not bypass).");
      }
      return { ok: false, notes };
    }

    const label = textOf(target) || target.getAttribute("aria-label") || "control";
    if (forbidden.test(label)) {
      notes.push("Blocked click on payment control: “" + label + "”");
      return { ok: false, notes };
    }

    highlight(target);
    try {
      target.click();
      notes.push("Clicked “" + label.slice(0, 60) + "”");
      return { ok: true, notes };
    } catch (err) {
      notes.push("Could not click control — try manually: “" + label.slice(0, 60) + "”");
      return { ok: false, notes };
    }
  }

  function setStatus(text, kind) {
    const el = document.querySelector("#qiangpiao-root .qp-status");
    if (!el) return;
    el.textContent = text;
    el.className = "qp-status" + (kind ? " " + kind : "");
  }

  function buildUi() {
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML =
      '<div class="qp-panel">' +
      '  <div class="qp-header">' +
      "    <strong>qiangpiao</strong>" +
      '    <button type="button" class="qp-toggle" data-action="collapse">Hide</button>' +
      "  </div>" +
      '  <div class="qp-body">' +
      '    <p class="qp-hint">Assist only. You handle queue, CAPTCHA, and final pay.</p>' +
      '    <div class="qp-status">Ready</div>' +
      '    <div class="qp-row">' +
      '      <label class="qp-label">Qty<input data-field="quantity" type="number" min="1" max="20" value="2" /></label>' +
      '      <label class="qp-label">Status' +
      '        <select data-field="status">' +
      '          <option value="watching">Watching</option>' +
      '          <option value="onsale">Onsale</option>' +
      '          <option value="limited">Limited</option>' +
      '          <option value="soldout">Sold out</option>' +
      '          <option value="got">Got tickets</option>' +
      '          <option value="failed">Failed</option>' +
      "        </select>" +
      "      </label>" +
      "    </div>" +
      '    <label class="qp-label">Preferred sections' +
      '      <input data-field="sectionNotes" type="text" placeholder="Floor, 101-105" />' +
      "    </label>" +
      '    <label class="qp-label">Price notes' +
      '      <input data-field="priceNotes" type="text" placeholder="under $150" />' +
      "    </label>" +
      '    <div class="qp-actions">' +
      '      <button type="button" class="qp-btn primary block" data-action="assist">Apply prefs + find tickets</button>' +
      '      <button type="button" class="qp-btn block" data-action="highlight">Highlight section/price matches</button>' +
      '      <button type="button" class="qp-btn block" data-action="watch">Save / update watch list</button>' +
      "    </div>" +
      '    <div class="qp-outcome">' +
      '      <button type="button" class="qp-btn" data-action="got">Got tickets</button>' +
      '      <button type="button" class="qp-btn" data-action="failed">Mark failed</button>' +
      "    </div>" +
      "  </div>" +
      "</div>";

    document.documentElement.appendChild(root);

    root.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "collapse") {
        root.classList.toggle("qp-collapsed");
        btn.textContent = root.classList.contains("qp-collapsed") ? "Show" : "Hide";
        return;
      }
      await handleAction(action);
    });
  }

  function readForm() {
    const root = document.getElementById(ROOT_ID);
    return {
      quantity: S.clampQuantity(
        root.querySelector('[data-field="quantity"]').value
      ),
      status: root.querySelector('[data-field="status"]').value,
      sectionNotes: root.querySelector('[data-field="sectionNotes"]').value.trim(),
      priceNotes: root.querySelector('[data-field="priceNotes"]').value.trim(),
    };
  }

  function fillForm(event) {
    const root = document.getElementById(ROOT_ID);
    if (!root || !event) return;
    root.querySelector('[data-field="quantity"]').value = String(event.quantity || 2);
    root.querySelector('[data-field="status"]').value = event.status || "watching";
    root.querySelector('[data-field="sectionNotes"]').value = event.sectionNotes || "";
    root.querySelector('[data-field="priceNotes"]').value = event.priceNotes || "";
  }

  async function persistFromForm(extra) {
    const form = readForm();
    const base = currentEvent || (await ensureEventRecord());
    const next = S.createWatchedEvent(
      Object.assign({}, base, form, {
        url: location.href.split("#")[0],
        label: base.label || pageTitleLabel(),
        eventId: base.eventId || S.extractEventId(location.href),
      }, extra || {})
    );
    await S.upsertWatchedEvent(next);
    currentEvent = next;
    return next;
  }

  async function handleAction(action) {
    clearHighlights();
    if (action === "watch") {
      await persistFromForm();
      setStatus("Saved to watch list", "ok");
      return;
    }

    if (action === "got" || action === "failed") {
      await persistFromForm({
        status: action === "got" ? "got" : "failed",
        lastOutcomeAt: new Date().toISOString(),
      });
      setStatus(action === "got" ? "Logged: got tickets" : "Logged: failed", "ok");
      fillForm(currentEvent);
      return;
    }

    if (action === "highlight") {
      const form = readForm();
      await persistFromForm();
      const notes = applySeatAssist(form.sectionNotes, form.priceNotes);
      setStatus(notes.join(" · ") || "No matches", notes.length ? "ok" : "");
      return;
    }

    if (action === "assist") {
      const form = readForm();
      await persistFromForm();
      const notes = [];
      notes.push.apply(notes, applyQuantity(form.quantity));
      notes.push.apply(notes, applySeatAssist(form.sectionNotes, form.priceNotes));
      const adv = advanceTowardCheckout();
      notes.push.apply(notes, adv.notes);
      setStatus(notes.join(" · "), adv.ok ? "ok" : "err");
      return;
    }
  }

  async function init() {
    if (!isLikelyEventPage()) return;
    buildUi();
    const existing = await S.findWatchedEvent(location.href);
    if (existing) {
      currentEvent = existing;
      fillForm(existing);
      const display = S.resolveDisplayStatus(existing);
      setStatus(display.label + " · qty " + existing.quantity);
    } else {
      currentEvent = await ensureEventRecord();
      fillForm(currentEvent);
      setStatus("Not watching yet — save to add");
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[S.STORAGE_KEYS.WATCH_LIST]) return;
      S.findWatchedEvent(location.href).then((ev) => {
        if (!ev) return;
        currentEvent = ev;
        fillForm(ev);
      });
    });

    // Soft SPA support: Ticketmaster often client-navigates
    let lastHref = location.href;
    statusTimer = setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        if (isLikelyEventPage()) {
          if (!document.getElementById(ROOT_ID)) buildUi();
          S.findWatchedEvent(location.href).then((ev) => {
            currentEvent = ev || S.createWatchedEvent({
              url: location.href.split("#")[0],
              label: pageTitleLabel() || undefined,
            });
            fillForm(currentEvent);
          });
        }
      }
    }, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
