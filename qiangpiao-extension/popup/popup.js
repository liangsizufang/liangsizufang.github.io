(function () {
  const S = globalThis.QiangpiaoStorage;
  const els = {
    form: document.getElementById("addForm"),
    url: document.getElementById("urlInput"),
    label: document.getElementById("labelInput"),
    qty: document.getElementById("qtyInput"),
    onsale: document.getElementById("onsaleInput"),
    section: document.getElementById("sectionInput"),
    price: document.getElementById("priceInput"),
    addCurrent: document.getElementById("addCurrentBtn"),
    list: document.getElementById("watchList"),
    count: document.getElementById("listCount"),
    version: document.getElementById("versionBadge"),
  };

  const STATUS_OPTIONS = [
    { value: "watching", label: "Watching" },
    { value: "onsale", label: "Onsale open" },
    { value: "limited", label: "Limited" },
    { value: "soldout", label: "Sold out" },
    { value: "got", label: "Got tickets" },
    { value: "failed", label: "Failed" },
  ];

  function isTicketmasterUrl(url) {
    try {
      const u = new URL(url);
      return /(^|\.)ticketmaster\.com$/i.test(u.hostname);
    } catch {
      return false;
    }
  }

  function toLocalInputValue(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function fromLocalInputValue(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  async function load() {
    const manifest = chrome.runtime.getManifest();
    els.version.textContent = "v" + manifest.version;
    const settings = await S.getSettings();
    els.qty.value = String(settings.defaultQuantity || 2);
    await render();
  }

  async function render() {
    const list = await S.getWatchList();
    els.count.textContent = String(list.length);
    els.list.innerHTML = "";

    list.forEach((event) => {
      const display = S.resolveDisplayStatus(event);
      const card = document.createElement("article");
      card.className = "card";
      card.setAttribute("role", "listitem");
      card.dataset.id = event.id;

      const title = document.createElement("div");
      title.className = "card-title";

      const link = document.createElement("a");
      link.href = event.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = event.label || event.eventId;

      const status = document.createElement("span");
      status.className = "status " + display.status;
      status.textContent = display.label;

      title.appendChild(link);
      title.appendChild(status);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent =
        "Qty " +
        event.quantity +
        (event.eventId ? " · id " + event.eventId : "");

      const prefs = document.createElement("div");
      prefs.className = "prefs";
      const bits = [];
      if (event.sectionNotes) bits.push("Sections: " + event.sectionNotes);
      if (event.priceNotes) bits.push("Price: " + event.priceNotes);
      prefs.textContent = bits.join(" · ") || "No section/price notes";

      const actions = document.createElement("div");
      actions.className = "actions";

      const openBtn = button("Open", "small", async () => {
        await chrome.tabs.create({ url: event.url });
      });

      const editBtn = button("Edit", "small", () => toggleEdit(card, event));

      const removeBtn = button("Remove", "small danger", async () => {
        if (!confirm("Remove “" + event.label + "” from watch list?")) return;
        await S.removeWatchedEvent(event.id);
        await render();
      });

      actions.appendChild(openBtn);
      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(prefs);
      card.appendChild(actions);
      els.list.appendChild(card);
    });
  }

  function button(label, className, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn " + className;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function toggleEdit(card, event) {
    const existing = card.querySelector(".edit-grid");
    if (existing) {
      existing.remove();
      return;
    }

    const grid = document.createElement("div");
    grid.className = "edit-grid";

    grid.appendChild(
      field("Label", "text", event.label, "full", "edit-label")
    );
    grid.appendChild(
      field("Qty", "number", String(event.quantity), "", "edit-qty")
    );
    grid.appendChild(
      statusField(event.status)
    );
    grid.appendChild(
      field(
        "Onsale (local)",
        "datetime-local",
        toLocalInputValue(event.onsaleAt),
        "full",
        "edit-onsale"
      )
    );
    grid.appendChild(
      field("Sections", "text", event.sectionNotes || "", "full", "edit-section")
    );
    grid.appendChild(
      field("Price notes", "text", event.priceNotes || "", "full", "edit-price")
    );

    const save = button("Save", "small primary", async () => {
      const updated = S.createWatchedEvent({
        ...event,
        label: grid.querySelector("[data-key=edit-label]").value.trim() || event.label,
        quantity: S.clampQuantity(grid.querySelector("[data-key=edit-qty]").value),
        status: grid.querySelector("[data-key=edit-status]").value,
        onsaleAt: fromLocalInputValue(
          grid.querySelector("[data-key=edit-onsale]").value
        ),
        sectionNotes: grid.querySelector("[data-key=edit-section]").value.trim(),
        priceNotes: grid.querySelector("[data-key=edit-price]").value.trim(),
        lastOutcomeAt: ["got", "failed", "soldout"].includes(
          grid.querySelector("[data-key=edit-status]").value
        )
          ? new Date().toISOString()
          : event.lastOutcomeAt,
      });
      await S.upsertWatchedEvent(updated);
      await render();
    });
    save.style.gridColumn = "1 / -1";
    grid.appendChild(save);
    card.appendChild(grid);
  }

  function field(labelText, type, value, extraClass, key) {
    const label = document.createElement("label");
    if (extraClass) label.className = extraClass;
    label.appendChild(document.createTextNode(labelText));
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.dataset.key = key;
    if (type === "number") {
      input.min = "1";
      input.max = "20";
    }
    label.appendChild(input);
    return label;
  }

  function statusField(value) {
    const label = document.createElement("label");
    label.appendChild(document.createTextNode("Status"));
    const select = document.createElement("select");
    select.dataset.key = "edit-status";
    STATUS_OPTIONS.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      select.appendChild(o);
    });
    label.appendChild(select);
    return label;
  }

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = els.url.value.trim();
    if (!isTicketmasterUrl(url)) {
      alert("Please use a ticketmaster.com (US) event URL.");
      return;
    }
    const event = S.createWatchedEvent({
      url,
      label: els.label.value.trim() || undefined,
      quantity: S.clampQuantity(els.qty.value),
      sectionNotes: els.section.value.trim(),
      priceNotes: els.price.value.trim(),
      onsaleAt: fromLocalInputValue(els.onsale.value),
    });
    await S.upsertWatchedEvent(event);
    await S.setSettings({ defaultQuantity: S.clampQuantity(els.qty.value) });
    els.form.reset();
    els.qty.value = String((await S.getSettings()).defaultQuantity);
    await render();
  });

  els.addCurrent.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !isTicketmasterUrl(tab.url)) {
      alert("Open a ticketmaster.com page first, then try again.");
      return;
    }
    els.url.value = tab.url;
    if (!els.label.value) {
      els.label.value = tab.title
        ? tab.title.replace(/\s*\|\s*Ticketmaster.*$/i, "").trim()
        : S.deriveLabel(tab.url);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[S.STORAGE_KEYS.WATCH_LIST]) {
      render();
    }
  });

  // Refresh countdowns periodically while popup is open
  setInterval(() => {
    if (document.visibilityState === "visible") render();
  }, 15000);

  load();
})();
