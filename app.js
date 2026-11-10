// Mensappen – liten interaktivitet för chips, räknare och totalsumma

// Chips: enval (data-single) eller flerval
document.querySelectorAll(".chips").forEach((group) => {
  const single = group.hasAttribute("data-single");
  group.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip || chip.dataset.action) return;
    const pressed = chip.getAttribute("aria-pressed") === "true";
    if (single) {
      group.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      chip.setAttribute("aria-pressed", "true");
    } else {
      chip.setAttribute("aria-pressed", String(!pressed));
    }
  });
});

// "+ Lägg till" symtom
document.querySelectorAll('[data-action="add-symptom"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = prompt("Vilket symtom vill du lägga till?");
    if (!name || !name.trim()) return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", "true");
    chip.textContent = name.trim();
    btn.before(chip);
  });
});

// Ditt paket: räknare, kryssrutor och totalsumma
const pkg = document.querySelector("[data-package]");
if (pkg) {
  const totalEl = document.querySelector("[data-total]");
  const recalc = () => {
    let sum = 0;
    pkg.querySelectorAll(".row").forEach((row) => {
      const cb = row.querySelector('input[type="checkbox"]');
      const out = row.querySelector("output");
      const price = Number(row.dataset.price || 0);
      if (!cb.checked) return;
      sum += price * (out ? Number(out.value) : 1);
    });
    totalEl.textContent = sum + " kr";
  };

  pkg.querySelectorAll(".row").forEach((row) => {
    const cb = row.querySelector('input[type="checkbox"]');
    const out = row.querySelector("output");
    if (!out) return;
    row.querySelectorAll(".stepper button").forEach((b) => {
      b.addEventListener("click", () => {
        const next = Math.max(0, Math.min(9, Number(out.value) + Number(b.dataset.step)));
        out.value = next;
        cb.checked = next > 0;
        recalc();
      });
    });
    cb.addEventListener("change", () => {
      if (cb.checked && Number(out.value) === 0) out.value = 1;
      if (!cb.checked) out.value = 0;
    });
  });

  pkg.addEventListener("change", recalc);
  recalc();
}

// Räckte ditt paket? – bekräftelse
document.querySelectorAll("[data-answer]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const msg = document.querySelector("[data-thanks]");
    if (msg) msg.textContent = "Tack! Vi anpassar ditt nästa paket.";
    setTimeout(() => (location.href = "index.html"), 1200);
  });
});

// Kalender: ritar månaden och markerar mens, beräknad mens och ägglossning
const calGrid = document.querySelector("[data-cal-grid]");
if (calGrid) {
  const TODAY = new Date(2026, 10, 9);       // appens "idag" (9 nov)
  const LAST_START = new Date(2026, 9, 29);  // senaste mensstart (29 okt)
  const CYCLE = 28;
  const PERIOD_LEN = 5;
  const DAY = 86400000;
  const titleEl = document.querySelector("[data-month-title]");
  let view = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);

  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const dayInCycle = (d) => {
    const diff = Math.round((d - LAST_START) / DAY);
    return ((diff % CYCLE) + CYCLE) % CYCLE; // 0 = första mensdagen
  };

  const render = () => {
    calGrid.innerHTML = "";
    const y = view.getFullYear();
    const m = view.getMonth();
    titleEl.textContent = view.toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
    const offset = (new Date(y, m, 1).getDay() + 6) % 7; // måndag först
    const days = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < offset; i++) {
      const s = document.createElement("span");
      s.className = "day empty";
      calGrid.append(s);
    }
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const a = document.createElement("a");
      a.href = "logga.html";
      a.className = "day";
      a.textContent = d;
      const c = dayInCycle(date);
      const isPeriod = c < PERIOD_LEN && date >= new Date(2026, 8, 1);
      const label = [date.toLocaleDateString("sv-SE", { day: "numeric", month: "long" })];
      if (isPeriod && date <= TODAY) { a.classList.add("period"); label.push("mens"); }
      else if (isPeriod) { a.classList.add("predicted"); label.push("beräknad mens"); }
      if (c === 14) { a.classList.add("ovulation"); label.push("ägglossning"); }
      if (sameDay(date, TODAY)) { a.classList.add("today"); label.push("idag"); a.setAttribute("aria-current", "date"); }
      a.setAttribute("aria-label", label.join(", "));
      calGrid.append(a);
    }
  };

  document.querySelectorAll("[data-month]").forEach((b) =>
    b.addEventListener("click", () => {
      view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.month), 1);
      render();
    })
  );
  render();
}
