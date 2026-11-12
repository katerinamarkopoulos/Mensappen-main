// Blomstra – sparad data, cykelberäkningar och interaktivitet för alla sidor

/* ===============================================================
   Datumhjälp
================================================================ */
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const fmt = (d, opts) => d.toLocaleDateString("sv-SE", opts);
const shortDate = (d) => fmt(d, { day: "numeric", month: "short" }).replace(".", "");
const toISO = (d) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fromISO = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const dagar = (n) => (n === 1 ? "1 dag" : n + " dagar");
const params = new URLSearchParams(location.search);

/* ===============================================================
   Produkter och sparad data
   Allt sparas i webbläsaren (localStorage) på den här enheten.
================================================================ */
const PRODUCTS = [
  { id: "bindor-dag", name: "Bindor dag", price: 20, addon: false },
  { id: "bindor-natt", name: "Bindor natt", price: 20, addon: false },
  { id: "tamponger", name: "Tamponger", price: 20, addon: false },
  { id: "trosskydd", name: "Trosskydd", price: 20, addon: false },
  { id: "toapapper", name: "Toapapper", price: 20, addon: true },
  { id: "rengoring", name: "Rengöring för menskopp", price: 20, addon: true },
  { id: "kondomer", name: "Kondomer", price: 20, addon: true },
  { id: "intimtval", name: "Intimtvål", price: 20, addon: true },
  { id: "intimservetter", name: "Intimservetter", price: 20, addon: true },
];

const INTERVALS = { 1: "Varje månad", 2: "Varannan månad", 3: "Var tredje månad", 6: "En gång per halvår" };
const DEFAULT_SYMPTOMS = ["Mensvärk", "Huvudvärk", "Trötthet", "Humör", "Värmevallning", "Sömn"];

// Data sparas per konto (se auth.js) – i webbläsaren på den här enheten
const clone = (o) => JSON.parse(JSON.stringify(o));
const state = loadUserState();
const saveState = () => Auth.saveState(state);
const user = Auth.current() || { name: "", email: "", created: new Date().toISOString() };

// Tillbaka-länkar och omdirigering efter sparande går till sidan man kom ifrån
const PUBLIC_PAGES = /(valkommen|loggain|registrera)\.html/;
const cameFrom = (fallback) => {
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === location.origin && ref.pathname !== location.pathname && !PUBLIC_PAGES.test(ref.pathname)) return ref.href;
  } catch (e) {}
  return fallback;
};
document.querySelectorAll("a.back").forEach((a) => {
  if (PUBLIC_PAGES.test(location.pathname)) return;
  a.href = cameFrom(a.dataset.fallback || a.getAttribute("href"));
});

// Visa sparade ändringar även när man går tillbaka med webbläsarens bakåtknapp
window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

/* ---------- Ny dag: kalendern och cykeln följer dagens datum ----------
   Sidan räknar allt utifrån datumet när den öppnades (APP_TODAY i auth.js). Blir det ett nytt
   dygn medan appen är öppen – eller när man kommer tillbaka till den – laddas sidan om.
   All data är redan sparad, så inget försvinner. Ingen bakgrundsprocess: en timer till midnatt
   plus en koll när appen syns igen (timers pausas ofta när mobilen sover). */
(() => {
  if (params.get("dag")) return; // förhandsvisning av en annan cykeldag
  const loadedOn = toISO(APP_TODAY);
  const busy = () => {
    const a = document.activeElement;
    // Vänta om man håller på att skriva eller har ett ark öppet, så att inget halvfärdigt försvinner
    return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || document.querySelector(".sheet:not([hidden])");
  };
  const check = () => {
    if (toISO(new Date()) === loadedOn) return schedule();
    if (document.visibilityState !== "visible" || busy()) return setTimeout(check, 60000);
    location.reload();
  };
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(check, Math.min(midnight - now + 1000, 3600000)); // max en timme, t.ex. vid tidszonsbyte
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  window.addEventListener("focus", check);
  schedule();
})();

// Öppen i flera flikar: har en annan flik sparat ändringar laddas den här om, så att den inte
// skriver över nya loggningar med sin gamla kopia nästa gång den sparar
window.addEventListener("storage", (e) => {
  if (e.key !== Auth.stateKey() && e.key !== "mensappen-session") return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return; // skriver man något just nu får det vara kvar
  location.reload();
});

// Be webbläsaren att inte rensa appens data automatiskt (t.ex. när lagringen blir full)
try {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
} catch (e) {}

/* ===============================================================
   Cykelmodell – räknas fram ur sparade mensstarter
   Tips: lägg till ?dag=20 i adressen för att förhandsvisa en annan cykeldag.
================================================================ */
const CYCLE = {
  askBefore: 3,                  // dagar före mens vi frågar om paket
  today: new Date(APP_TODAY),    // appens "idag", se auth.js
};

const periodStarts = () =>
  [...new Set(state.logs.filter((l) => l.start).map((l) => l.date))]
    .map(fromISO)
    .filter((d) => d && d <= CYCLE.today)
    .sort((a, b) => a - b);

// Snittcykel av de senaste mellanrummen (21–45 dagar räknas), annars 28
const averageLength = (starts) => {
  const gaps = starts.slice(1).map((d, i) => daysBetween(starts[i], d)).filter((g) => g >= 21 && g <= 45).slice(-6);
  return gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 28;
};

// Snittlängd på mensen: sista loggade mensdagen inom 10 dagar efter varje start, annars 5
const averagePeriod = (starts) => {
  const mensDays = state.logs.filter((l) => l.type === "mens").map((l) => fromISO(l.date)).filter(Boolean);
  const lengths = starts
    .map((s) => Math.max(0, ...mensDays.map((d) => daysBetween(s, d)).filter((g) => g >= 0 && g <= 10)) + 1)
    .filter((n) => n >= 2)
    .slice(-6);
  return lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 5;
};

const starts = periodStarts();
CYCLE.autoLength = averageLength(starts);
CYCLE.autoPeriod = averagePeriod(starts);
CYCLE.length = state.settings.cycleLength || CYCLE.autoLength; // eget värde från Profil går före
CYCLE.period = state.settings.periodLength || CYCLE.autoPeriod;
CYCLE.ovulation = Math.max(CYCLE.period + 2, CYCLE.length - 14); // ägglossning ca 14 dagar före nästa mens
// Utan loggad mens hittar appen inte på någon cykel: inga cykeldagar eller prognoser visas.
// (Startdatumet nedan används då bara internt, t.ex. för paketets standardleverans.)
CYCLE.hasData = starts.length > 0;
// Prognosen bygger på bara en mens och inget eget värde – visas som en tydlig uppskattning
CYCLE.standardLength = starts.length < 2 && !state.settings.cycleLength;
CYCLE.start = starts[starts.length - 1] || new Date(CYCLE.today);

const dagParam = Number(params.get("dag"));
if (dagParam >= 1 && dagParam <= CYCLE.length) CYCLE.today = addDays(CYCLE.start, dagParam - 1);

const today = CYCLE.today;
// Dagar sedan senaste mensstart (1 = startdagen). Går det längre än en cykel är mensen sen –
// då börjar appen inte om på en påhittad ny cykel.
CYCLE.sinceStart = daysBetween(CYCLE.start, today) + 1;
CYCLE.daysLate = CYCLE.hasData ? Math.max(0, CYCLE.sinceStart - CYCLE.length) : 0;

// Cykeldag (1 = första mensdagen) räknat från senaste start
const cycleDay = (date) => {
  const n = daysBetween(CYCLE.start, date);
  return (((n % CYCLE.length) + CYCLE.length) % CYCLE.length) + 1;
};

const phaseFor = (day) => {
  if (day <= CYCLE.period) return "mensfasen";
  if (day < CYCLE.ovulation - 1) return "follikulärfasen";
  if (day <= CYCLE.ovulation + 1) return "ägglossningsfasen";
  return "lutealfasen";
};

const todayDay = CYCLE.daysLate ? CYCLE.length : cycleDay(today);
const daysToPeriod = CYCLE.daysLate ? 0 : CYCLE.length - todayDay + 1;
// Är mensen sen räknas nästa beräknade mens från i morgon
const nextPeriod = addDays(today, CYCLE.daysLate ? 1 : daysToPeriod);
const askDate = addDays(nextPeriod, -CYCLE.askBefore);
const daysToOvulation = CYCLE.ovulation - todayDay;
const ovulationDate = addDays(today, daysToOvulation);

const setText = (sel, text) => document.querySelectorAll(sel).forEach((el) => (el.textContent = text));

setText("[data-today]", fmt(today, { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (c) => c.toUpperCase()));
setText("[data-today-short]", shortDate(today));

/* ---------- Personligt: namn och profil ---------- */
const firstName = (user.name || "").split(" ")[0];
setText("[data-user-name]", firstName ? "Hej " + firstName + "!" : "Hej!");
setText("[data-user-fullname]", user.name || "Ditt namn");
setText("[data-user-initial]", (user.name || "?").charAt(0).toUpperCase());
setText("[data-user-email]", user.email);
setText("[data-member-since]", "Medlem sedan " + fmt(new Date(user.created), { month: "long", year: "numeric" }));
const contraception = PROFILE_OPTIONS.contraception.find((o) => o.id === state.profile.contraception);
document.querySelectorAll("[data-hormonal-note]").forEach((el) => (el.hidden = !(contraception && contraception.hormonal)));
document.querySelectorAll("[data-no-logs]").forEach((el) => {
  el.hidden = !CYCLE.standardLength;
  if (CYCLE.hasData) el.textContent = "Uppskattning utifrån en vanlig cykel på " + dagar(CYCLE.length) + ". Ju fler mensar du loggar, desto mer träffsäker blir prognosen.";
});
document.querySelectorAll("[data-phase-open]").forEach((el) => (el.hidden = !CYCLE.hasData));
setText("[data-phase]", phaseFor(todayDay));

/* ===============================================================
   Faserna: information till pop-up och faser.html
================================================================ */
const PHASES = [
  {
    key: "mensfasen",
    id: "mensfasen",
    title: "Mensfasen",
    range: () => [1, CYCLE.period],
    lead: "Livmoderns slemhinna stöts ut och kommer ut som mens. Cykeln börjar om från dag 1.",
    happens: "Östrogen och progesteron är som lägst. Kroppen gör sig av med slemhinnan som byggdes upp förra cykeln.",
    feel: "Mensvärk, trötthet och lägre energi är vanligt. Vissa får huvudvärk eller blir känsligare för kyla.",
    tip: "Värme på magen, vila och lugn rörelse som promenader kan lindra. Drick ordentligt.",
  },
  {
    key: "follikulärfasen",
    id: "follikularfasen",
    title: "Follikulärfasen",
    range: () => [CYCLE.period + 1, CYCLE.ovulation - 2],
    lead: "Kroppen förbereder sig för ägglossning. Ett ägg mognar i en av äggstockarna.",
    happens: "Östrogenet stiger och slemhinnan i livmodern byggs upp igen. Flera folliklar växer, men oftast mognar bara en.",
    feel: "Många känner mer energi, bättre humör och mer lust att vara social.",
    tip: "En bra tid att prova nya saker eller träna lite hårdare om du vill.",
  },
  {
    key: "ägglossningsfasen",
    id: "agglossningsfasen",
    title: "Ägglossningsfasen",
    range: () => [CYCLE.ovulation - 1, CYCLE.ovulation + 1],
    lead: "Ett moget ägg släpps från äggstocken. Det är nu chansen att bli gravid är störst.",
    happens: "En topp av hormonet LH utlöser ägglossningen. Östrogenet är som högst och ägget lever i ungefär ett dygn.",
    feel: "Flytningen kan bli klar och töjbar. Vissa känner ett lätt hugg i ena sidan av nedre magen.",
    tip: "Vill du undvika graviditet: använd skydd. Spermier kan leva i flera dagar innan ägglossningen.",
  },
  {
    key: "lutealfasen",
    id: "lutealfasen",
    title: "Lutealfasen",
    range: () => [CYCLE.ovulation + 2, CYCLE.length],
    lead: "Kroppen förbereder sig för en eventuell graviditet. Blir det ingen sjunker hormonerna och mensen kommer.",
    happens: "Gulkroppen bildar progesteron som gör slemhinnan redo. Mot slutet sjunker både progesteron och östrogen.",
    feel: "Mot slutet är PMS vanligt: ömma bröst, uppblåsthet, sug efter mat och humörsvängningar.",
    tip: "Regelbundna måltider, sömn och rörelse kan göra PMS lättare. Bra tid att kolla att paketet är på väg.",
  },
];
const currentPhase = CYCLE.hasData ? PHASES.find((p) => p.key === phaseFor(todayDay)) : null;
const rangeText = (p) => {
  const [a, b] = p.range();
  return a === b ? "Dag " + a : "Dag " + a + "–" + b;
};

const phaseSection = (heading, text) => {
  const wrap = document.createElement("div");
  wrap.className = "phase-section";
  const h = document.createElement("h3");
  h.textContent = heading;
  const p = document.createElement("p");
  p.textContent = text;
  wrap.append(h, p);
  return wrap;
};

// Pop-up på översikten
const phaseOpen = document.querySelector("[data-phase-open]");
const phaseSheet = document.querySelector("#phase-sheet");
if (phaseOpen && phaseSheet && currentPhase) {
  const fill = () => {
    phaseSheet.querySelector("[data-sheet-range]").textContent = rangeText(currentPhase) + " · Du är på dag " + todayDay;
    phaseSheet.querySelector("[data-sheet-title]").textContent = currentPhase.title;
    phaseSheet.querySelector("[data-sheet-lead]").textContent = currentPhase.lead;
    const body = phaseSheet.querySelector("[data-sheet-body]");
    body.innerHTML = "";
    body.append(
      phaseSection("Vad händer i kroppen", currentPhase.happens),
      phaseSection("Vanligt att känna", currentPhase.feel),
      phaseSection("Tips", currentPhase.tip)
    );
    phaseSheet.querySelector("[data-sheet-more]").href = "faser.html#" + currentPhase.id;
  };
  const panel = phaseSheet.querySelector(".sheet-inner");
  const open = () => {
    fill();
    phaseSheet.hidden = false;
    document.body.style.overflow = "hidden";
    phaseOpen.setAttribute("aria-expanded", "true");
    panel.scrollTop = 0;
    panel.focus();
  };
  const close = () => {
    phaseSheet.hidden = true;
    document.body.style.overflow = "";
    phaseOpen.setAttribute("aria-expanded", "false");
    phaseOpen.focus();
  };
  phaseOpen.addEventListener("click", open);
  phaseSheet.querySelectorAll("[data-sheet-close]").forEach((el) => el.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (phaseSheet.hidden) return;
    if (e.key === "Escape") close();
    // Håll tangentbordsfokus inne i rutan
    if (e.key === "Tab") {
      const items = [...panel.querySelectorAll("a[href], button")];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// faser.html: alla faser, nuvarande markerad
const phaseList = document.querySelector("[data-phase-list]");
if (phaseList) {
  PHASES.forEach((p) => {
    const card = document.createElement("article");
    card.className = "card phase-card" + (p === currentPhase ? " current" : "");
    card.id = p.id;
    const top = document.createElement("div");
    top.className = "phase-card-top";
    const range = document.createElement("span");
    range.className = "phase-range";
    range.textContent = rangeText(p);
    top.append(range);
    if (p === currentPhase) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Du är här · dag " + todayDay;
      top.append(badge);
    }
    const h = document.createElement("h2");
    h.textContent = p.title;
    const lead = document.createElement("p");
    lead.className = "phase-lead";
    lead.textContent = p.lead;
    card.append(top, h, lead,
      phaseSection("Vad händer i kroppen", p.happens),
      phaseSection("Vanligt att känna", p.feel),
      phaseSection("Tips", p.tip));
    phaseList.append(card);
  });
  setText("[data-phase-cycle]", dagar(CYCLE.length));
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: "start" });
  }
}
setText("[data-cycle-day]", "Dag " + todayDay);
setText("[data-cycle-length]", "av ca " + CYCLE.length);
setText("[data-cycle-length-value]", dagar(CYCLE.length));
setText("[data-period-length-value]", dagar(CYCLE.period));
setText("[data-days-to-period]", dagar(daysToPeriod));
setText("[data-next-period]", shortDate(nextPeriod));
setText("[data-ask-date]", shortDate(askDate));
setText(
  "[data-ovulation-text]",
  daysToOvulation > 0 ? "Ägglossning om ca " + dagar(daysToOvulation) + " (" + shortDate(ovulationDate) + ")"
  : daysToOvulation === 0 ? "Ägglossning ca idag"
  : "Ägglossningen har passerat"
);
// Mensen är sen: visa det i stället för en ny påhittad cykel
if (CYCLE.daysLate) {
  setText("[data-cycle-day]", "Dag " + CYCLE.sinceStart);
  document.querySelectorAll("[data-period-line]").forEach((el) =>
    (el.textContent = "Mensen är ca " + dagar(CYCLE.daysLate) + " sen enligt uppskattningen"));
}
// Leveransfrågan (leverans.html)
document.querySelectorAll("[data-delivery-lead]").forEach((el) => {
  if (!CYCLE.hasData) el.textContent = "Vill du få ditt paket hemskickat? Logga din mens så kan vi anpassa leveransen efter din cykel.";
  else if (CYCLE.daysLate) el.textContent = "Enligt uppskattningen är mensen ca " + dagar(CYCLE.daysLate) + " sen. Vill du få ditt paket hemskickat?";
});
// Ingen loggad mens: inga cykeldagar, ingen ägglossning och inget datum för nästa mens
if (!CYCLE.hasData) {
  setText("[data-cycle-day]", "–");
  setText("[data-cycle-length]", "ingen mens loggad");
  document.querySelectorAll("[data-period-line], [data-ovu-line]").forEach((el) => (el.hidden = true));
  setText("[data-next-period]", "när du loggat din mens");
  document.querySelectorAll("[data-delivery-meta]").forEach((el) =>
    (el.textContent = "Logga din mens så vet vi när vi ska fråga · Inget skickas utan ditt ja"));
}

/* ---------- Paketet: summa och etiketter ---------- */
const packageTotal = () =>
  PRODUCTS.reduce((sum, p) => sum + p.price * (state.package.items[p.id] || 0), 0);
const whenLabel = () =>
  state.package.when === "interval" ? INTERVALS[state.package.interval] || "Fast intervall" : "Inför varje mens";
// Leveransen tar 1–2 dagar, så tidigast om två dagar
const earliestDelivery = addDays(today, 2);
// Datum man själv valt på Ditt paket (gäller bara om det ligger framåt i tiden)
const chosenDelivery = () => {
  const d = fromISO(state.package.deliveryDate);
  return d && d >= earliestDelivery ? d : null;
};
const nextIntervalDelivery = (months, ignoreChosen) => {
  const picked = ignoreChosen ? null : fromISO(state.package.deliveryDate);
  if (picked && picked >= earliestDelivery) return picked;
  // Valt datum som passerat blir startpunkt för intervallet
  const base = picked || (state.delivery && state.delivery.status === "ordered" && fromISO(state.delivery.date)) || today;
  let next = new Date(base.getFullYear(), base.getMonth() + months, base.getDate());
  while (next <= today) next = new Date(next.getFullYear(), next.getMonth() + months, next.getDate());
  return next;
};
const suggestedDelivery = (when, interval) => {
  if (when === "interval") return nextIntervalDelivery(interval, true);
  const before = addDays(nextPeriod, -2); // hemma ett par dagar innan mensen
  return before < earliestDelivery ? earliestDelivery : before;
};
const isPaused = () => {
  const d = state.delivery;
  const until = d && fromISO(d.until);
  return !!(d && d.status === "paused" && until && until > today);
};
const dateWithYear = (d) =>
  fmt(d, { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined }).replace(".", "");

setText("[data-package-total]", packageTotal() + " kr");
setText("[data-when-label]", whenLabel());

/* ===============================================================
   Översikt: cykelringen
================================================================ */
const ring = document.querySelector("[data-ring]");
if (ring) {
  const NS = "http://www.w3.org/2000/svg";
  const C = 100, R = 88;
  // Färgskala från rosa till vinröd – passerade dagar blir rödare ju längre cykeln gått
  const from = [236, 140, 182], to = [168, 18, 63];
  const mix = (t) => "rgb(" + from.map((f, k) => Math.round(f + (to[k] - f) * t)).join(",") + ")";
  const FUTURE = "#eedde5";

  const pos = (i, r) => {
    const a = ((i - 1) / CYCLE.length) * 2 * Math.PI - Math.PI / 2;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  for (let i = 1; i <= CYCLE.length; i++) {
    const passed = CYCLE.hasData && i <= todayDay;
    const color = passed ? mix(todayDay === 1 ? 1 : (i - 1) / (CYCLE.length - 1)) : FUTURE;
    if (i === CYCLE.ovulation) {
      const [x, y] = pos(i, R);
      ring.append(el("circle", { cx: x, cy: y, r: 6, fill: passed ? color : CYCLE.hasData ? "#df62a0" : FUTURE }));
    } else {
      const [x1, y1] = pos(i, R - 7);
      const [x2, y2] = pos(i, R + 7);
      ring.append(el("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 4, "stroke-linecap": "round" }));
    }
  }
  if (!CYCLE.hasData) {
    // Ingen loggad mens: tom ring utan markör, och inga påhittade datum att bläddra mellan
    ring.removeAttribute("tabindex");
    ring.setAttribute("role", "img");
    ring.setAttribute("aria-label", "Cykelring, ingen mens loggad än");
  } else {
  // "Du är här"-markör för idag
  const [tx, ty] = pos(todayDay, R);
  ring.append(el("circle", { cx: tx, cy: ty, r: 9, fill: "#fff", stroke: mix(1), "stroke-width": 3.5 }));

  /* ---------- Håll på / hovra över cirkeln: visa dag, datum och fas ---------- */
  const wrap = ring.closest(".ring");
  const dayEl = wrap.querySelector("[data-cycle-day]");
  const subEl = wrap.querySelector("[data-cycle-length]");
  const phaseEl = wrap.querySelector("[data-ring-phase]");
  const defaults = [dayEl.textContent, subEl.textContent];
  const pick = el("circle", { r: 10, fill: "none", stroke: "#a8123f", "stroke-width": 2.5, visibility: "hidden" });
  ring.append(pick);
  let shown = todayDay;

  const phaseName = (i) => PHASES.find((p) => p.key === phaseFor(i)).title;
  const dateOf = (i) => addDays(today, i - todayDay);
  const describe = (i) => {
    const date = dateOf(i);
    const when = i === todayDay ? "idag" : fmt(date, { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
    const extra = i === CYCLE.ovulation ? " · ägglossning" : "";
    return { when, phase: phaseName(i) + extra };
  };
  const show = (i) => {
    shown = i;
    const d = describe(i);
    wrap.classList.add("scrubbing");
    dayEl.textContent = "Dag " + i;
    subEl.textContent = d.when;
    phaseEl.textContent = d.phase;
    phaseEl.hidden = false;
    const [x, y] = pos(i, R);
    pick.setAttribute("cx", x);
    pick.setAttribute("cy", y);
    pick.setAttribute("visibility", i === todayDay ? "hidden" : "visible");
    ring.setAttribute("aria-valuenow", i);
    ring.setAttribute("aria-valuetext", "Dag " + i + ", " + d.when + ", " + d.phase);
  };
  const reset = () => {
    shown = todayDay;
    wrap.classList.remove("scrubbing");
    dayEl.textContent = defaults[0];
    subEl.textContent = defaults[1];
    phaseEl.hidden = true;
    pick.setAttribute("visibility", "hidden");
    ring.setAttribute("aria-valuenow", todayDay);
    ring.setAttribute("aria-valuetext", "Cykeldag " + todayDay + " av " + CYCLE.length + ", " + phaseName(todayDay) + ", mens om ca " + dagar(daysToPeriod));
  };

  // Vilken dag pekar man på? Bara på själva ringen, inte i mitten.
  const dayAt = (clientX, clientY) => {
    const box = ring.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * 200 - C;
    const y = ((clientY - box.top) / box.height) * 200 - C;
    const dist = Math.hypot(x, y);
    if (dist < R - 24 || dist > R + 26) return null;
    let a = Math.atan2(y, x) + Math.PI / 2;
    if (a < 0) a += 2 * Math.PI;
    return (Math.round((a / (2 * Math.PI)) * CYCLE.length) % CYCLE.length) + 1;
  };

  // Mus: hovra
  ring.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const i = dayAt(e.clientX, e.clientY);
    if (i) show(i); else reset();
  });
  ring.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") reset(); });

  // Touch: håll fingret på ringen och dra runt. Sidan scrollar inte när man börjar på ringen.
  let touching = false;
  let resetTimer = null;
  ring.addEventListener("touchstart", (e) => {
    clearTimeout(resetTimer);
    const t = e.touches[0];
    const i = dayAt(t.clientX, t.clientY);
    if (!i) return; // i mitten: låt sidan scrolla som vanligt
    e.preventDefault();
    touching = true;
    show(i);
  }, { passive: false });
  ring.addEventListener("touchmove", (e) => {
    if (!touching) return;
    e.preventDefault();
    const t = e.touches[0];
    const box = ring.getBoundingClientRect();
    // Under dragningen räcker det att vara i närheten av ringen
    const x = ((t.clientX - box.left) / box.width) * 200 - C;
    const y = ((t.clientY - box.top) / box.height) * 200 - C;
    let a = Math.atan2(y, x) + Math.PI / 2;
    if (a < 0) a += 2 * Math.PI;
    show((Math.round((a / (2 * Math.PI)) * CYCLE.length) % CYCLE.length) + 1);
  }, { passive: false });
  const endTouch = () => {
    if (!touching) return;
    touching = false;
    resetTimer = setTimeout(reset, 1200); // låt texten synas en stund efter att man släppt
  };
  ring.addEventListener("touchend", endTouch);
  ring.addEventListener("touchcancel", endTouch);

  // Tangentbord: piltangenterna stegar dag för dag
  ring.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (e.key === "Escape" || e.key === "Home") { e.preventDefault(); reset(); return; }
    if (!step) return;
    e.preventDefault();
    show(((shown - 1 + step + CYCLE.length) % CYCLE.length) + 1);
  });
  ring.addEventListener("blur", reset);
  ring.setAttribute("aria-valuemax", CYCLE.length);
  reset();
  }
}

/* ===============================================================
   Översikt: leveranskortet speglar sparade val
================================================================ */
const deliveryTitle = document.querySelector("[data-delivery-title]");
const deliveryMeta = document.querySelector("[data-delivery-meta]");
if (deliveryTitle && deliveryMeta) {
  const d = state.delivery;
  const sameCycle = d && d.cycleStart === toISO(CYCLE.start);
  const until = d && fromISO(d.until);
  if (isPaused()) {
    deliveryTitle.textContent = "Leveranserna är pausade";
    deliveryMeta.textContent = "Till " + dateWithYear(until) + " · Inget skickas under pausen";
  } else if (d && d.status === "ordered" && sameCycle) {
    deliveryTitle.textContent = "Ditt paket är på väg";
    const arrive = fromISO(d.arrive);
    deliveryMeta.textContent = "Beställt " + shortDate(fromISO(d.date)) + " · " + d.total + " kr · " + (arrive ? "Levereras " + shortDate(arrive) : "Leverans 1–2 dagar");
  } else if (d && d.status === "skipped" && sameCycle) {
    deliveryTitle.textContent = "Vi hoppar över denna gång";
    deliveryMeta.textContent = "Vi frågar igen inför nästa mens";
  } else if (state.package.when === "interval") {
    deliveryTitle.textContent = "Fast intervall: " + whenLabel().toLowerCase();
    deliveryMeta.textContent = (chosenDelivery() ? "Nästa paket " : "Nästa paket ca ") + dateWithYear(nextIntervalDelivery(state.package.interval)) + " · " + packageTotal() + " kr";
  } else if (chosenDelivery()) {
    deliveryMeta.textContent = "Önskad leverans " + dateWithYear(chosenDelivery()) + " · Vi frågar dig innan, inget skickas utan ditt ja";
  }
}

/* ---------- Leveransadress ---------- */
const address = () => state.profile.address || null;
const addressText = (a) => a.street + ", " + a.zip + " " + a.city;
const fillAddressForm = (form, a) => {
  form.street.value = (a && a.street) || "";
  form.zip.value = (a && a.zip) || "";
  form.city.value = (a && a.city) || "";
};
// Läser och kontrollerar formuläret. Returnerar adressen, eller null och visar fel.
const readAddressForm = (form) => {
  const err = form.querySelector("[data-form-error]");
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  const fail = (field, msg) => { err.textContent = msg; field.setAttribute("aria-invalid", "true"); field.focus(); return null; };
  const street = form.street.value.trim();
  const zipDigits = form.zip.value.replace(/\s/g, "");
  const city = form.city.value.trim();
  if (!street) return fail(form.street, "Skriv gatuadress.");
  if (!/^\d{5}$/.test(zipDigits)) return fail(form.zip, "Postnumret ska vara 5 siffror.");
  if (!city) return fail(form.city, "Skriv ort.");
  err.textContent = "";
  const cityNice = city.charAt(0).toUpperCase() + city.slice(1);
  return { street, zip: zipDigits.slice(0, 3) + " " + zipDigits.slice(3), city: cityNice };
};
document.querySelectorAll("[data-address-short]").forEach((el) => {
  el.textContent = address() ? address().street : "Lägg till";
  el.classList.toggle("empty", !address());
});

// Bottenark med fokus som stannar inne och Esc för att stänga
const makeSheet = (sheet, opener) => {
  const panel = sheet.querySelector(".sheet-inner");
  const api = {
    open() {
      sheet.hidden = false;
      document.body.style.overflow = "hidden";
      opener.setAttribute("aria-expanded", "true");
      panel.scrollTop = 0;
      panel.focus();
    },
    close() {
      sheet.hidden = true;
      document.body.style.overflow = "";
      opener.setAttribute("aria-expanded", "false");
      opener.focus();
    },
  };
  sheet.querySelectorAll("[data-sheet-close]").forEach((el) => el.addEventListener("click", api.close));
  document.addEventListener("keydown", (e) => {
    if (sheet.hidden) return;
    if (e.key === "Escape") api.close();
    if (e.key === "Tab") {
      const items = [...panel.querySelectorAll("a[href], button, input")].filter((el) => el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  return api;
};

/* ---------- Leverans: Ja, skicka paketet → bekräfta adress → kvitto ---------- */
const orderOpen = document.querySelector("[data-order-open]");
const orderSheet = document.querySelector("#order-sheet");
if (orderOpen && orderSheet) {
  const sheet = makeSheet(orderSheet, orderOpen);
  const form = orderSheet.querySelector('[data-order-step="address"]');
  const step = (name) => {
    orderSheet.querySelectorAll("[data-order-step]").forEach((el) => (el.hidden = el.dataset.orderStep !== name));
    const current = orderSheet.querySelector('[data-order-step="' + name + '"]');
    const title = current.querySelector(".sheet-title");
    if (title) title.focus();
  };
  const showConfirm = () => {
    const a = address();
    if (!a) return showForm();
    orderSheet.querySelector("[data-address-name]").textContent = user.name;
    orderSheet.querySelector("[data-address-lines]").textContent = a.street + "\n" + a.zip + " " + a.city;
    orderSheet.querySelector("[data-order-when]").textContent = chosenDelivery() ? dateWithYear(chosenDelivery()) : "Inom 1–2 dagar";
    step("confirm");
  };
  const showForm = () => {
    fillAddressForm(form, address());
    form.querySelector("[data-address-form-title]").textContent = address() ? "Ändra adress" : "Vart ska paketet?";
    form.querySelector("[data-order-back]").hidden = !address();
    form.querySelector("[data-form-error]").textContent = "";
    step("address");
  };

  orderOpen.addEventListener("click", () => { sheet.open(); showConfirm(); });
  orderSheet.querySelector("[data-order-edit]").addEventListener("click", showForm);
  orderSheet.querySelector("[data-order-back]").addEventListener("click", showConfirm);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const a = readAddressForm(form);
    if (!a) return;
    state.profile.address = a;
    saveState();
    showConfirm();
  });

  orderSheet.querySelector("[data-order-confirm]").addEventListener("click", () => {
    const arrive = chosenDelivery();
    state.delivery = {
      status: "ordered",
      date: toISO(today),
      cycleStart: toISO(CYCLE.start),
      total: packageTotal(),
      until: null,
      arrive: arrive ? toISO(arrive) : null,
      address: address(),
    };
    if (state.package.when === "cycle") state.package.deliveryDate = null;
    state.orders = [...(state.orders || []), { date: toISO(today), total: packageTotal() }]; // ger ett kronblad
    if (!saveState()) return;
    updateKronbladBadge();
    orderSheet.querySelector("[data-order-receipt]").textContent =
      "Vi skickar det till " + addressText(address()) + ". Det är hemma hos dig " +
      (arrive ? "den " + fmt(arrive, { day: "numeric", month: "long" }) : "inom 1–2 dagar") + ". Du fick också ett kronblad!";
    step("done");
  });
}

/* ---------- Pausade leveranser: visa och återuppta ---------- */
document.querySelectorAll("[data-resume]").forEach((btn) => {
  btn.hidden = !isPaused();
  btn.addEventListener("click", () => {
    state.delivery = null;
    if (saveState()) location.reload();
  });
});
// Ditt paket: pausa direkt eller visa att det är pausat
const pauseForm = document.querySelector("[data-pause-form]");
if (pauseForm) {
  const active = document.querySelector("[data-pause-active]");
  const months = () => Number((pauseForm.querySelector('.chip[aria-pressed="true"]') || {}).dataset?.months || 3);
  const untilDate = (m) => new Date(today.getFullYear(), today.getMonth() + m, today.getDate());
  const preview = () => setText("[data-pause-preview]", dateWithYear(untilDate(months())));
  active.hidden = !isPaused();
  pauseForm.hidden = isPaused();
  if (isPaused()) setText("[data-paused-until]", dateWithYear(fromISO(state.delivery.until)));
  pauseForm.querySelector("[data-pause-months]").addEventListener("click", () => setTimeout(preview));
  preview();
  pauseForm.querySelector("[data-pause-now]").addEventListener("click", () => {
    state.delivery = {
      status: "paused",
      date: toISO(today),
      cycleStart: toISO(CYCLE.start),
      total: packageTotal(),
      until: toISO(untilDate(months())),
    };
    if (saveState()) location.reload();
  });
}

const pausedCard = document.querySelector("[data-paused-card]");
if (pausedCard && isPaused()) {
  pausedCard.hidden = false;
  setText("[data-paused-until]", dateWithYear(fromISO(state.delivery.until)));
  document.querySelectorAll("[data-pause-link]").forEach((a) => (a.hidden = true));
}
setText("[data-delivery-note]", chosenDelivery() ? "Levereras " + dateWithYear(chosenDelivery()) : "Leverans 1–2 dagar");

/* ===============================================================
   Chips (enval med data-single, annars flerval)
================================================================ */
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

const makeChip = (text, pressed) => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.setAttribute("aria-pressed", String(pressed));
  chip.textContent = text;
  return chip;
};

/* ===============================================================
   Gemensam loggning – används av Logga-sidan och kalendern
================================================================ */
let idSeq = 0;
const newId = () => String(Date.now() + idSeq++);
const within = (from, to, min, max) => { const g = daysBetween(from, to); return g >= min && g <= max; };

// Ny mensstart om ingen start finns 0–10 dagar före. Starter 1–10 dagar efter slås ihop med denna.
const claimStart = (date) => {
  const startLogs = state.logs.filter((l) => l.start);
  if (startLogs.some((l) => within(fromISO(l.date), date, 0, 10))) return false;
  startLogs.forEach((l) => { if (within(date, fromISO(l.date), 1, 10)) l.start = false; });
  return true;
};
// Lägger till eller uppdaterar dagens logg av en viss typ
const upsertLog = (date, type, fields) => {
  const iso = toISO(date);
  let log = state.logs.find((l) => l.date === iso && l.type === type);
  const start = type === "mens" ? (log && log.start) || claimStart(date) : false;
  if (!log) {
    log = { id: newId(), date: iso, type, flow: "", symptoms: [], note: "" };
    state.logs.push(log);
  }
  // updated: när loggen senast ändrades – behövs för att kunna slå ihop data mellan enheter utan dubbletter
  Object.assign(log, fields, { start, updated: new Date().toISOString() });
  return log;
};
// Tar bort en logg. Var det mensens första dag tar nästa mensdag över som start.
const removeLog = (date, type) => {
  const iso = toISO(date);
  const log = state.logs.find((l) => l.date === iso && l.type === type);
  if (!log) return;
  state.logs = state.logs.filter((l) => l !== log);
  if (log.start) {
    const next = state.logs
      .filter((l) => l.type === "mens" && within(date, fromISO(l.date), 1, 10))
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    if (next) next.start = claimStart(fromISO(next.date));
  }
};
const findLog = (date, type) => state.logs.find((l) => l.date === toISO(date) && l.type === type);
// Namn på en loggning i listor och rapporten
const logLabel = (l) => (l.start ? "Mensen började" : l.type === "mens" ? "Mens" : l.type === "sex" ? "Sex" : "Symtom");
const logDetails = (l) => [l.flow, l.protection, (l.symptoms || []).join(", "), l.note].filter(Boolean).join(" · ");

/* ===============================================================
   Logga: egna symtom, datumväljare och spara
================================================================ */
const addBtn = document.querySelector('[data-action="add-symptom"]');
const addForm = document.querySelector("#add-symptom");
if (addBtn) {
  // Egna symtom som sparats tidigare visas som val
  state.customSymptoms.forEach((name) => addBtn.before(makeChip(name, false)));
}
if (addBtn && addForm) {
  const input = addForm.querySelector("input");
  const toggle = (open) => {
    addForm.hidden = !open;
    addBtn.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
    else { input.value = ""; addBtn.focus(); }
  };
  addBtn.addEventListener("click", () => toggle(addForm.hidden));
  addForm.querySelector("[data-cancel]").addEventListener("click", () => toggle(false));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") toggle(false); });
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const existing = [...addBtn.parentElement.querySelectorAll(".chip:not([data-action])")]
      .find((c) => c.textContent.trim().toLowerCase() === name.toLowerCase());
    if (existing) existing.setAttribute("aria-pressed", "true");
    else addBtn.before(makeChip(name.charAt(0).toUpperCase() + name.slice(1), true));
    toggle(false);
  });
}

let logDate = today; // datumet som loggas

const pickBtn = document.querySelector('[data-action="pick-date"]');
const picker = document.querySelector("#date-picker");
if (pickBtn && picker) {
  const grid = picker.querySelector("[data-picker-grid]");
  const title = picker.querySelector("[data-picker-title]");
  const nextBtn = picker.querySelector('[data-picker-month="1"]');
  const group = pickBtn.parentElement;
  let view = new Date(today.getFullYear(), today.getMonth(), 1);

  const render = () => {
    grid.innerHTML = "";
    const y = view.getFullYear(), m = view.getMonth();
    title.textContent = fmt(view, { month: "long", year: "numeric" });
    nextBtn.disabled = y === today.getFullYear() && m === today.getMonth();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < offset; i++) {
      const s = document.createElement("span");
      s.className = "day empty";
      grid.append(s);
    }
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day";
      b.textContent = d;
      b.setAttribute("aria-label", fmt(date, { weekday: "long", day: "numeric", month: "long" }));
      if (date > today) b.disabled = true;
      if (sameDay(date, today)) b.classList.add("today");
      if (sameDay(date, logDate)) {
        b.classList.add("selected");
        b.setAttribute("aria-pressed", "true");
      }
      b.addEventListener("click", () => { choose(date); pickBtn.focus(); });
      grid.append(b);
    }
  };

  const open = (isOpen) => {
    picker.hidden = !isOpen;
    pickBtn.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) render();
  };

  const choose = (date) => {
    logDate = date;
    group.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    // Idag/Igår väljs direkt om datumet råkar vara ett av dem
    const quick = group.querySelector('[data-date-offset="' + daysBetween(today, date) + '"]');
    if (quick) {
      quick.setAttribute("aria-pressed", "true");
      pickBtn.textContent = "Välj datum";
    } else {
      pickBtn.setAttribute("aria-pressed", "true");
      pickBtn.textContent = shortDate(date);
    }
    open(false);
  };

  pickBtn.addEventListener("click", () => open(picker.hidden));
  picker.querySelectorAll("[data-picker-month]").forEach((b) =>
    b.addEventListener("click", () => {
      view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.pickerMonth), 1);
      render();
    })
  );
  group.querySelectorAll("[data-date-offset]").forEach((c) =>
    c.addEventListener("click", () => {
      logDate = addDays(today, Number(c.dataset.dateOffset));
      pickBtn.textContent = "Välj datum";
      open(false);
    })
  );

  // Från kalendern: logga.html?datum=2026-11-03
  const preset = fromISO(params.get("datum"));
  if (preset && preset <= today) {
    view = new Date(preset.getFullYear(), preset.getMonth(), 1);
    choose(preset);
  }
}

const saveLogBtn = document.querySelector("[data-save-log]");
if (saveLogBtn) {
  const type = ["symtom", "sex", "dag"].includes(params.get("typ")) ? params.get("typ") : "mens";
  // "Logga" på översikten: symtom och/eller sex samma dag
  if (type === "dag") {
    setText("[data-log-title]", "Logga");
    document.title = "Blomstra – Logga";
    setText(".picker-title", "Vilken dag?");
    document.querySelectorAll("[data-flow-section]").forEach((el) => (el.hidden = true));
    document.querySelectorAll("[data-sex-section], [data-sex-toggle-row]").forEach((el) => (el.hidden = false));
    const sexSwitch = document.querySelector("[data-log-sex]");
    const protWrap = document.querySelector("[data-protection-wrap]");
    sexSwitch.addEventListener("change", () => (protWrap.hidden = !sexSwitch.checked));
    const symBox = document.querySelector("[data-symptoms]");
    const addBtn = symBox.querySelector('[data-action="add-symptom"]');
    const note = document.querySelector("#note");
    // Fyll i det som redan är loggat den valda dagen, så att inget skrivs över av misstag
    const fill = () => {
      const sym = findLog(logDate, "symtom");
      const sex = findLog(logDate, "sex");
      const chosen = new Set(sym ? sym.symptoms : []);
      chosen.forEach((name) => {
        if (![...symBox.querySelectorAll(".chip:not([data-action])")].some((c) => c.textContent.trim() === name)) symBox.insertBefore(makeChip(name, true), addBtn);
      });
      symBox.querySelectorAll(".chip:not([data-action])").forEach((c) => c.setAttribute("aria-pressed", String(chosen.has(c.textContent.trim()))));
      sexSwitch.checked = !!sex;
      protWrap.hidden = !sex;
      document.querySelectorAll("[data-protection] .chip").forEach((c) => c.setAttribute("aria-pressed", String(!!sex && c.textContent.trim() === sex.protection)));
      note.value = (sym && sym.note) || (sex && sex.note) || "";
    };
    fill();
    // Byter man dag fylls den dagens loggningar i
    document.querySelectorAll("[data-date-offset], [data-picker-grid]").forEach((el) => el.addEventListener("click", () => setTimeout(fill, 0)));
  }
  if (type === "sex") {
    setText("[data-log-title]", "Logga sex");
    document.title = "Blomstra – Logga sex";
    document.querySelectorAll("[data-flow-section], [data-symptom-section]").forEach((el) => (el.hidden = true));
    document.querySelectorAll("[data-sex-section]").forEach((el) => (el.hidden = false));
    setText(".picker-title", "Vilken dag?");
    // Finns det redan en loggning den dagen fylls den i
    const prev = findLog(logDate, "sex");
    if (prev) {
      document.querySelectorAll("[data-protection] .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.textContent.trim() === prev.protection)));
      const n = document.querySelector("#note");
      if (n) n.value = prev.note || "";
    }
  }
  if (type === "symtom") {
    setText("[data-log-title]", "Logga symtom");
    document.title = "Blomstra – Logga symtom";
    const flow = document.querySelector("[data-flow-section]");
    if (flow) flow.hidden = true;
  }

  saveLogBtn.addEventListener("click", () => {
    const pressed = (sel) =>
      [...document.querySelectorAll(sel + ' .chip[aria-pressed="true"]:not([data-action])')].map((c) => c.textContent.trim());
    const symptoms = pressed("[data-symptoms]");
    const flow = type === "mens" ? pressed("[data-flow]")[0] || "" : "";
    const note = (document.querySelector("#note") || {}).value || "";
    if (type === "dag") {
      const sexOn = document.querySelector("[data-log-sex]").checked;
      const text = note.trim();
      const sym = findLog(logDate, "symtom");
      const sex = findLog(logDate, "sex");
      // Symtom (och anteckningen) sparas som symtomlogg; finns bara sex följer anteckningen med den
      const noteOnSym = symptoms.length > 0 || !sexOn;
      if (symptoms.length || (text && noteOnSym)) upsertLog(logDate, "symtom", { symptoms, note: noteOnSym ? text : "" });
      else if (sym) removeLog(logDate, "symtom");
      if (sexOn) upsertLog(logDate, "sex", { protection: pressed("[data-protection]")[0] || "", note: noteOnSym ? (sex && sex.note !== text ? sex.note || "" : "") : text });
      else if (sex) removeLog(logDate, "sex");
      symptoms.forEach((x) => {
        if (!DEFAULT_SYMPTOMS.includes(x) && !state.customSymptoms.includes(x)) state.customSymptoms.push(x);
      });
      const status = document.querySelector("[data-log-status]");
      if (saveState()) {
        saveLogBtn.textContent = "Sparat ✓";
        const what = [symptoms.length && "symtom", sexOn && "sex"].filter(Boolean).join(" och ");
        if (status) status.textContent = what ? what.charAt(0).toUpperCase() + what.slice(1) + " sparat " + shortDate(logDate) + "." : "Sparat.";
        setTimeout(() => location.replace(cameFrom("index.html")), 900);
      } else if (status) status.textContent = "Kunde inte spara på den här enheten.";
      return;
    }
    if (type === "sex") {
      upsertLog(logDate, "sex", { protection: pressed("[data-protection]")[0] || "", note: note.trim() });
      const status = document.querySelector("[data-log-status]");
      if (saveState()) {
        saveLogBtn.textContent = "Sparat ✓";
        if (status) status.textContent = "Sex loggat " + shortDate(logDate) + ".";
        setTimeout(() => location.replace(cameFrom("index.html")), 900);
      } else if (status) status.textContent = "Kunde inte spara på den här enheten.";
      return;
    }

    // Inom 10 dagar efter en start räknas det som samma mens (se upsertLog)
    const start = upsertLog(logDate, type, { flow, symptoms, note: note.trim() }).start;

    symptoms.forEach((s) => {
      if (!DEFAULT_SYMPTOMS.includes(s) && !state.customSymptoms.includes(s)) state.customSymptoms.push(s);
    });

    const status = document.querySelector("[data-log-status]");
    if (saveState()) {
      saveLogBtn.textContent = "Sparat ✓";
      if (status) status.textContent = start ? "Ny mens registrerad från " + shortDate(logDate) + "." : "Din loggning är sparad.";
      setTimeout(() => location.replace(cameFrom("index.html")), 900);
    } else if (status) {
      status.textContent = "Kunde inte spara på den här enheten.";
    }
  });
}

/* ===============================================================
   Ditt paket: räknare, intervall och spara
================================================================ */
const pkg = document.querySelector("[data-package]");
if (pkg) {
  const rows = [...pkg.querySelectorAll(".row[data-id]")];
  const totalEl = document.querySelector("[data-total]");
  const intervalBox = document.querySelector("#interval-options");
  const nextEl = intervalBox && intervalBox.querySelector("[data-next-delivery]");

  // Fyll i sparade val
  rows.forEach((row) => {
    const qty = state.package.items[row.dataset.id] || 0;
    row.querySelector('input[type="checkbox"]').checked = qty > 0;
    const out = row.querySelector("output");
    if (out) out.value = qty;
  });
  const whenInput = pkg.querySelector('input[name="when"][value="' + state.package.when + '"]');
  if (whenInput) whenInput.checked = true;
  const intervalInput = pkg.querySelector('input[name="interval"][value="' + state.package.interval + '"]');
  if (intervalInput) intervalInput.checked = true;

  // Leveransdatum: eget val eller förslag utifrån cykeln
  let picked = chosenDelivery();
  const dRow = document.querySelector("[data-delivery-pick]");
  const dPicker = document.querySelector("#delivery-picker");
  const dGrid = dPicker && dPicker.querySelector("[data-dpicker-grid]");
  const dTitle = dPicker && dPicker.querySelector("[data-dpicker-title]");
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 7, 0); // ca ett halvår framåt
  let dView = new Date((picked || today).getFullYear(), (picked || today).getMonth(), 1);
  setText("[data-delivery-min]", shortDate(earliestDelivery));

  const shownDelivery = (draft) => picked || suggestedDelivery(draft.when, draft.interval);
  const renderPicker = (draft) => {
    if (!dGrid) return;
    const sel = shownDelivery(draft);
    dGrid.innerHTML = "";
    const y = dView.getFullYear(), m = dView.getMonth();
    dTitle.textContent = fmt(dView, { month: "long", year: "numeric" });
    dPicker.querySelector('[data-dpicker-month="-1"]').disabled = y === today.getFullYear() && m === today.getMonth();
    dPicker.querySelector('[data-dpicker-month="1"]').disabled = y === lastDay.getFullYear() && m === lastDay.getMonth();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) {
      const sp = document.createElement("span");
      sp.className = "day empty";
      dGrid.append(sp);
    }
    for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++) {
      const date = new Date(y, m, d);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day";
      b.textContent = d;
      const label = [fmt(date, { weekday: "long", day: "numeric", month: "long" })];
      if (date < earliestDelivery || date > lastDay) b.disabled = true;
      if (date > today && cycleDay(date) <= CYCLE.period) { b.classList.add("predicted"); label.push("beräknad mens"); }
      if (sameDay(date, sel)) { b.classList.add("selected"); b.setAttribute("aria-pressed", "true"); }
      b.setAttribute("aria-label", label.join(", "));
      b.addEventListener("click", () => {
        picked = date;
        update();
        dRow.focus();
        openPicker(false);
      });
      dGrid.append(b);
    }
  };
  const openPicker = (isOpen) => {
    dPicker.hidden = !isOpen;
    dRow.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      const sel = shownDelivery(collect());
      dView = new Date(sel.getFullYear(), sel.getMonth(), 1);
      renderPicker(collect());
    }
  };
  if (dRow && dPicker) {
    dRow.addEventListener("click", () => openPicker(dPicker.hidden));
    dPicker.querySelectorAll("[data-dpicker-month]").forEach((b) =>
      b.addEventListener("click", () => {
        dView = new Date(dView.getFullYear(), dView.getMonth() + Number(b.dataset.dpickerMonth), 1);
        renderPicker(collect());
      })
    );
    dPicker.querySelector("[data-delivery-suggest]").addEventListener("click", () => {
      picked = null;
      update();
      openPicker(false);
      dRow.focus();
    });
  }

  const collect = () => {
    const items = {};
    rows.forEach((row) => {
      const cb = row.querySelector('input[type="checkbox"]');
      const out = row.querySelector("output");
      const qty = cb.checked ? (out ? Number(out.value) : 1) : 0;
      if (qty > 0) items[row.dataset.id] = qty;
    });
    return {
      items,
      when: pkg.querySelector('input[name="when"]:checked').value,
      interval: Number(pkg.querySelector('input[name="interval"]:checked').value),
      deliveryDate: picked ? toISO(picked) : null,
    };
  };

  const update = () => {
    const draft = collect();
    totalEl.textContent = PRODUCTS.reduce((s, p) => s + p.price * (draft.items[p.id] || 0), 0) + " kr";
    if (intervalBox) {
      intervalBox.hidden = draft.when !== "interval";
      nextEl.textContent = dateWithYear(shownDelivery(draft));
    }
    setText("[data-delivery-date]", dateWithYear(shownDelivery(draft)));
    setText("[data-delivery-source]", picked ? "Ditt valda datum" : draft.when === "interval" ? "Förslag utifrån intervallet" : "Förslag: ett par dagar före mensen");
    if (dPicker && !dPicker.hidden) renderPicker(draft);
  };

  rows.forEach((row) => {
    const cb = row.querySelector('input[type="checkbox"]');
    const out = row.querySelector("output");
    if (!out) return;
    row.querySelectorAll(".stepper button").forEach((b) => {
      b.addEventListener("click", () => {
        const next = Math.max(0, Math.min(9, Number(out.value) + Number(b.dataset.step)));
        out.value = next;
        cb.checked = next > 0;
        update();
      });
    });
    cb.addEventListener("change", () => {
      if (cb.checked && Number(out.value) === 0) out.value = 1;
      if (!cb.checked) out.value = 0;
    });
  });
  pkg.addEventListener("change", update);
  update();

  const saveBtn = document.querySelector("[data-save-package]");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      state.package = collect();
      state.packageSaved = true;
      if (!saveState()) { saveBtn.textContent = "Kunde inte spara"; return; }
      saveBtn.textContent = "Sparat ✓";
      const back = cameFrom("index.html");
      setTimeout(() => location.replace(back), 700);
    });
  }
}

/* ===============================================================
   Leverans: visar sparat paket och sparar valet
================================================================ */
const summary = document.querySelector("[data-package-summary]");
if (summary) {
  summary.innerHTML = "";
  const chosen = PRODUCTS.filter((p) => state.package.items[p.id]);
  if (!chosen.length) {
    const li = document.createElement("li");
    li.textContent = "Inget valt ännu – tryck på Ändra paket";
    summary.append(li);
  }
  chosen.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + " · " + state.package.items[p.id] + " förp" + (p.addon ? " (tillägg)" : "");
    summary.append(li);
  });
}

document.querySelectorAll("[data-delivery]").forEach((link) =>
  link.addEventListener("click", () => {
    const status = link.dataset.delivery;
    state.delivery = {
      status,
      date: toISO(today),
      cycleStart: toISO(CYCLE.start),
      total: packageTotal(),
      until: status === "paused" ? toISO(new Date(today.getFullYear(), today.getMonth() + 3, today.getDate())) : null,
      arrive: status === "ordered" && chosenDelivery() ? toISO(chosenDelivery()) : null,
    };
    // Inför varje mens: ett valt datum gäller bara den här beställningen
    if (status !== "paused" && state.package.when === "cycle") state.package.deliveryDate = null;
    saveState();
  })
);

/* ===============================================================
   Inställningar som sparas direkt (påminnelser)
================================================================ */
document.querySelectorAll("[data-pref]").forEach((input) => {
  const key = input.dataset.pref;
  if (key in state.prefs) input.checked = !!state.prefs[key];
  input.addEventListener("change", () => {
    state.prefs[key] = input.checked;
    saveState();
  });
});

const resetBtn = document.querySelector("[data-reset]");
if (resetBtn) {
  // Två steg: första trycket ber om bekräftelse, andra raderar
  const label = resetBtn.textContent;
  let armed = null;
  resetBtn.addEventListener("click", () => {
    if (!armed) {
      resetBtn.textContent = "Tryck igen för att radera kontot och all data – går inte att ångra";
      armed = setTimeout(() => { resetBtn.textContent = label; armed = null; }, 4000);
      return;
    }
    clearTimeout(armed);
    Auth.remove();
    location.href = "valkommen.html";
  });
}

/* ===============================================================
   Räckte ditt paket? – sparar svaret
================================================================ */
document.querySelectorAll("[data-answer]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const before = kronbladEarned();
    state.feedback.push({ date: toISO(today), answer: btn.dataset.answer });
    saveState();
    const msg = document.querySelector("[data-thanks]");
    if (msg) msg.textContent = "Tack! Vi anpassar ditt nästa paket." + (kronbladEarned() > before ? " Du fick ett kronblad!" : "");
    updateKronbladBadge();
    setTimeout(() => (location.href = "index.html"), 1200);
  });
});

/* ===============================================================
   Kalender: mens, beräknad mens och ägglossning från sparade starter
================================================================ */
const mensDates = new Set(state.logs.filter((l) => l.type === "mens").map((l) => l.date));
// Har man loggat minst två dagar av en mens visas de loggade dagarna, annars en uppskattning
// Loggade mensdagar för en mens (inom 10 dagar efter starten och före nästa start), som dagar efter starten
const loggedOffsets = (s, next) =>
  [...mensDates].map((iso) => daysBetween(s, fromISO(iso))).filter((g) => g >= 0 && g <= 10 && (!next || g < daysBetween(s, next)));
const dayInfo = (date) => {
  const logged = mensDates.has(toISO(date));
  let idx = -1;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= date) idx = i;
  if (idx < 0) return { period: logged };
  const s = starts[idx];
  const next = starts[idx + 1];
  const d = daysBetween(s, date) + 1;
  const offsets = loggedOffsets(s, next);
  const estimate = offsets.length < 2;
  // Lucka: en dag mellan två loggade mensdagar som inte är loggad – mensen pågick troligen då
  const gap = !logged && !estimate && d - 1 < Math.max(...offsets);
  if (next) return { period: logged || (estimate && d <= CYCLE.period), gap, ovulation: d === CYCLE.ovulation, day: d, logged };
  // Pågående cykel (fram till idag, även om mensen är sen): bara det som hänt, inga prognoser bakåt i tiden
  if (date <= today || d <= CYCLE.length) {
    return {
      logged,
      gap,
      period: logged || (estimate && d <= CYCLE.period && date <= today),
      predicted: !logged && !gap && estimate && d <= CYCLE.period && date > today,
      ovulation: d === CYCLE.ovulation,
      day: d,
    };
  }
  // Framtiden: beräknade cykler räknat från nästa beräknade mens (uppskattning)
  const c = ((daysBetween(nextPeriod, date) % CYCLE.length) + CYCLE.length) % CYCLE.length + 1;
  return {
    logged,
    gap: false,
    period: logged,
    predicted: !logged && c <= CYCLE.period,
    ovulation: c === CYCLE.ovulation,
    day: c,
  };
};

const calGrid = document.querySelector("[data-cal-grid]");
if (calGrid) {
  const titleEl = document.querySelector("[data-month-title]");
  const hint = document.querySelector("[data-cal-hint]");
  const monthParam = /^(\d{4})-(\d{2})$/.exec(params.get("manad") || "");
  let view = monthParam ? new Date(+monthParam[1], +monthParam[2] - 1, 1) : new Date(today.getFullYear(), today.getMonth(), 1);
  let multi = false;
  const selected = new Set();
  const HINT = "Tryck på en dag för att logga.";

  // Efter sparande: ladda om på samma månad och visa vad som sparades
  const reloadWith = (msg) => {
    try { sessionStorage.setItem("cal-msg", msg); } catch (e) {}
    location.replace("kalender.html?manad=" + view.getFullYear() + "-" + String(view.getMonth() + 1).padStart(2, "0"));
  };
  try {
    const msg = sessionStorage.getItem("cal-msg");
    if (msg) { hint.textContent = msg + " ✓"; hint.classList.add("saved"); sessionStorage.removeItem("cal-msg"); }
  } catch (e) {}

  const render = () => {
    calGrid.innerHTML = "";
    const y = view.getFullYear();
    const m = view.getMonth();
    titleEl.textContent = fmt(view, { month: "long", year: "numeric" });
    const offset = (new Date(y, m, 1).getDay() + 6) % 7; // måndag först
    const days = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < offset; i++) {
      const s = document.createElement("span");
      s.className = "day empty";
      calGrid.append(s);
    }
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const past = date <= today;
      const cell = document.createElement(past ? "button" : "span");
      if (past) cell.type = "button";
      cell.className = "day";
      cell.textContent = d;
      const info = dayInfo(date);
      const label = [fmt(date, { weekday: "long", day: "numeric", month: "long" })];
      if (info.day) label.push("cykeldag " + info.day);
      if (info.period) { cell.classList.add("period"); label.push(info.logged ? "mens loggad" : "mens, uppskattad"); }
      else if (info.gap) { cell.classList.add("predicted", "gap"); label.push("ej loggad, trolig mens"); }
      else if (info.predicted) { cell.classList.add("predicted"); label.push("beräknad mens"); }
      if (info.ovulation) { cell.classList.add("ovulation"); label.push("ägglossning"); }
      if (findLog(date, "symtom")) { cell.classList.add("has-symptom"); label.push("symtom loggat"); }
      if (findLog(date, "sex")) { cell.classList.add("has-sex"); label.push("sex loggat"); }
      if (sameDay(date, today)) { cell.classList.add("today"); label.push("idag"); cell.setAttribute("aria-current", "date"); }
      if (past && multi) {
        const on = selected.has(toISO(date));
        cell.classList.toggle("selected", on);
        cell.setAttribute("aria-pressed", String(on));
      }
      cell.setAttribute("aria-label", label.join(", "));
      if (past) cell.addEventListener("click", () => (multi ? toggleDay(date, cell) : openDay(date, cell)));
      calGrid.append(cell);
    }
  };

  document.querySelectorAll("[data-month]").forEach((b) =>
    b.addEventListener("click", () => {
      view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.month), 1);
      render();
    })
  );

  /* ---------- Flera dagar ---------- */
  const multiBtn = document.querySelector("[data-multi-toggle]");
  const bar = document.querySelector("[data-multi-bar]");
  const countEl = bar.querySelector("[data-multi-count]");
  const saveMulti = bar.querySelector("[data-multi-save]");
  const removeMulti = bar.querySelector("[data-multi-remove]");
  const updateBar = () => {
    const n = selected.size;
    countEl.textContent = n ? (n === 1 ? "1 dag vald" : n + " dagar valda") : "Inga dagar valda";
    saveMulti.disabled = n === 0;
    saveMulti.textContent = n > 1 ? "Logga " + n + " dagar som mens" : "Logga som mens";
    removeMulti.hidden = ![...selected].some((iso) => mensDates.has(iso));
  };
  const setMulti = (on) => {
    multi = on;
    selected.clear();
    multiBtn.setAttribute("aria-pressed", String(on));
    multiBtn.textContent = on ? "Klar" : "Välj flera dagar";
    bar.hidden = !on;
    document.body.classList.toggle("multi-mode", on);
    hint.classList.remove("saved");
    hint.textContent = on ? "Tryck på alla dagar du hade mens." : HINT;
    bar.querySelectorAll("[data-multi-flow] .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    updateBar();
    render();
  };
  const toggleDay = (date, cell) => {
    const iso = toISO(date);
    if (selected.has(iso)) selected.delete(iso);
    else selected.add(iso);
    cell.classList.toggle("selected", selected.has(iso));
    cell.setAttribute("aria-pressed", String(selected.has(iso)));
    updateBar();
  };
  multiBtn.addEventListener("click", () => setMulti(!multi));
  bar.querySelector("[data-multi-cancel]").addEventListener("click", () => { setMulti(false); multiBtn.focus(); });
  saveMulti.addEventListener("click", () => {
    const flowChip = bar.querySelector('[data-multi-flow] .chip[aria-pressed="true"]');
    const fields = flowChip ? { flow: flowChip.textContent.trim() } : {};
    const dates = [...selected].sort().map(fromISO); // äldst först, så första dagen blir mensstart
    dates.forEach((d) => upsertLog(d, "mens", fields));
    if (saveState()) reloadWith(dagar(dates.length) + " loggade som mens");
  });
  removeMulti.addEventListener("click", () => {
    const dates = [...selected].filter((iso) => mensDates.has(iso)).sort().reverse().map(fromISO);
    dates.forEach((d) => removeLog(d, "mens"));
    if (saveState()) reloadWith("Mens borttagen från " + dagar(dates.length));
  });

  /* ---------- En dag: snabbloggning ---------- */
  const daySheet = document.querySelector("#day-sheet");
  let openDay = () => {};
  if (daySheet) {
    let opener = calGrid;
    const sheet = makeSheet(daySheet, { setAttribute() {}, focus: () => opener.focus() });
    const mensSwitch = daySheet.querySelector("[data-day-mens]");
    const flowSection = daySheet.querySelector("[data-day-flow-section]");
    const flowChips = [...daySheet.querySelectorAll("[data-day-flow] .chip")];
    const symptomBox = daySheet.querySelector("[data-day-symptoms]");
    const sexSwitch = daySheet.querySelector("[data-day-sex]");
    const protSection = daySheet.querySelector("[data-day-protection-section]");
    const protChips = [...daySheet.querySelectorAll("[data-day-protection] .chip")];
    sexSwitch.addEventListener("change", () => (protSection.hidden = !sexSwitch.checked));
    let current = null;

    mensSwitch.addEventListener("change", () => {
      flowSection.hidden = !mensSwitch.checked;
      if (mensSwitch.checked && !flowChips.some((c) => c.getAttribute("aria-pressed") === "true")) flowChips[1].setAttribute("aria-pressed", "true");
    });

    openDay = (date, cell) => {
      current = date;
      opener = cell;
      const mens = findLog(date, "mens");
      const sym = findLog(date, "symtom");
      const info = dayInfo(date);
      daySheet.querySelector("[data-day-title]").textContent = fmt(date, { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (c) => c.toUpperCase());
      daySheet.querySelector("[data-day-sub]").textContent =
        (sameDay(date, today) ? "Idag" : info.day ? "Cykeldag " + info.day : "") +
        (mens ? (mens.start ? " · Mensen började" : " · Mens loggad") : info.gap ? " · Ej loggad – trolig mens" : "");
      mensSwitch.checked = !!mens;
      flowSection.hidden = !mens;
      flowChips.forEach((c) => c.setAttribute("aria-pressed", String(!!mens && c.textContent.trim() === mens.flow)));
      const chosen = new Set([...(mens ? mens.symptoms : []), ...(sym ? sym.symptoms : [])]);
      symptomBox.innerHTML = "";
      [...DEFAULT_SYMPTOMS, ...state.customSymptoms, ...[...chosen].filter((x) => !DEFAULT_SYMPTOMS.includes(x) && !state.customSymptoms.includes(x))]
        .forEach((name) => symptomBox.append(makeChip(name, chosen.has(name))));
      const sex = findLog(date, "sex");
      sexSwitch.checked = !!sex;
      protSection.hidden = !sex;
      protChips.forEach((c) => c.setAttribute("aria-pressed", String(!!sex && c.textContent.trim() === sex.protection)));
      daySheet.querySelector("[data-day-more]").href = "logga.html?datum=" + toISO(date) + "&typ=" + (mens ? "mens" : "symtom");
      sheet.open();
    };

    daySheet.querySelector("[data-day-save]").addEventListener("click", () => {
      const date = current;
      const symptoms = [...symptomBox.querySelectorAll('.chip[aria-pressed="true"]')].map((c) => c.textContent.trim());
      const flowChip = flowChips.find((c) => c.getAttribute("aria-pressed") === "true");
      const sym = findLog(date, "symtom");
      let msg;
      if (mensSwitch.checked) {
        upsertLog(date, "mens", { flow: flowChip ? flowChip.textContent.trim() : "", symptoms });
        // Symtomen ligger nu på mensloggen – en separat symtomlogg behövs bara för en anteckning
        if (sym && sym.note) sym.symptoms = []; else removeLog(date, "symtom");
        msg = "Mens loggad " + shortDate(date);
      } else {
        const hadMens = !!findLog(date, "mens");
        removeLog(date, "mens");
        if (symptoms.length) upsertLog(date, "symtom", { symptoms });
        else if (sym && !sym.note) removeLog(date, "symtom");
        msg = symptoms.length ? "Symtom sparade " + shortDate(date) : hadMens ? "Mens borttagen " + shortDate(date) : "Sparat " + shortDate(date);
      }
      // Sex: sparas som en egen loggning så att en anteckning från Logga-sidan finns kvar
      const hadSex = findLog(date, "sex");
      if (sexSwitch.checked) {
        const prot = protChips.find((c) => c.getAttribute("aria-pressed") === "true");
        upsertLog(date, "sex", { protection: prot ? prot.textContent.trim() : "" });
        if (!hadSex) msg = msg.startsWith("Sparat") ? "Sex loggat " + shortDate(date) : msg + " · sex loggat";
      } else if (hadSex) {
        removeLog(date, "sex");
        msg = msg.startsWith("Sparat") ? "Sex borttaget " + shortDate(date) : msg;
      }
      if (saveState()) reloadWith(msg);
    });
  }

  render();
}

const historyList = document.querySelector("[data-history]");
if (historyList) {
  historyList.innerHTML = "";
  const logs = [...state.logs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id) - Number(a.id))).slice(0, 6);
  if (!logs.length) {
    const li = document.createElement("li");
    li.innerHTML = "<b>Inget loggat ännu</b><span>Tryck på en dag i kalendern för att logga.</span>";
    historyList.append(li);
  }
  logs.forEach((l) => {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = shortDate(fromISO(l.date)) + " · " + logLabel(l);
    const span = document.createElement("span");
    const details = logDetails(l);
    span.textContent = details || "Inga detaljer";
    li.append(b, span);
    historyList.append(li);
  });
}


/* ===============================================================
   Profil: namn, frågorna från registreringen, cykellängd och menslängd
================================================================ */
const profileValue = {
  age: () => (state.profile.age ? state.profile.age + " år" : ""),
  contraception: () => optionLabel("contraception", state.profile.contraception) || "",
  protection: () => state.profile.protection.map((id) => optionLabel("protection", id)).filter(Boolean).join(", "),
};
document.querySelectorAll("[data-profile-value]").forEach((el) => {
  const text = profileValue[el.dataset.profileValue]();
  el.textContent = text || "Lägg till";
  el.classList.toggle("empty", !text);
});

// Fyll i val i redigerarna
const ageSelect = document.querySelector("[data-age-select]");
if (ageSelect) {
  for (let a = 12; a <= 60; a++) ageSelect.append(new Option(a + " år", a));
}
const contraList = document.querySelector("[data-contraception-options]");
if (contraList) {
  PROFILE_OPTIONS.contraception.forEach((o) => {
    const label = document.createElement("label");
    label.className = "row radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = contraList.dataset.contraceptionOptions || "contraception";
    input.value = o.id;
    label.append(input, " " + o.label);
    contraList.append(label);
  });
}
const protectionChips = document.querySelector("[data-protection-options]");
if (protectionChips) {
  PROFILE_OPTIONS.protection.forEach((o) => {
    const chip = makeChip(o.label, false);
    chip.dataset.value = o.id;
    protectionChips.append(chip);
  });
}

const EDITORS = {
  address: {
    fill: (ed) => { fillAddressForm(ed, address()); ed.querySelector("[data-form-error]").textContent = ""; },
    save: (ed) => {
      const a = readAddressForm(ed);
      if (!a) return false;
      state.profile.address = a;
      return saveState();
    },
  },
  name: {
    fill: (ed) => (ed.querySelector("input").value = user.name),
    save: (ed) => {
      const input = ed.querySelector("input");
      if (!input.value.trim()) { input.focus(); return false; }
      return Auth.update({ name: input.value.trim() });
    },
  },
  age: {
    fill: (ed) => (ed.querySelector("select").value = state.profile.age || ""),
    save: (ed) => { state.profile.age = Number(ed.querySelector("select").value) || null; return saveState(); },
  },
  contraception: {
    fill: (ed) => ed.querySelectorAll("input").forEach((i) => (i.checked = i.value === state.profile.contraception)),
    save: (ed) => { const c = ed.querySelector("input:checked"); state.profile.contraception = c ? c.value : null; return saveState(); },
  },
  protection: {
    fill: (ed) => ed.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(state.profile.protection.includes(c.dataset.value)))),
    save: (ed) => {
      state.profile.protection = [...ed.querySelectorAll('.chip[aria-pressed="true"]')].map((c) => c.dataset.value);
      return saveState();
    },
  },
  cycle: {
    fill: (ed) => (ed.querySelector("output").value = CYCLE.length),
    save: (ed) => { state.settings.cycleLength = Number(ed.querySelector("output").value); return saveState(); },
    auto: () => { state.settings.cycleLength = null; return saveState(); },
  },
  period: {
    fill: (ed) => (ed.querySelector("output").value = CYCLE.period),
    save: (ed) => { state.settings.periodLength = Number(ed.querySelector("output").value); return saveState(); },
    auto: () => { state.settings.periodLength = null; return saveState(); },
  },
};

document.querySelectorAll("[data-edit]").forEach((row) => {
  const key = row.dataset.edit;
  const editor = document.querySelector('[data-editor="' + key + '"]');
  const conf = EDITORS[key];
  if (!editor || !conf) return;

  const open = (isOpen) => {
    editor.hidden = !isOpen;
    row.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) conf.fill(editor);
  };
  row.addEventListener("click", () => {
    const willOpen = editor.hidden;
    document.querySelectorAll("[data-edit]").forEach((r) => {
      const ed = document.querySelector('[data-editor="' + r.dataset.edit + '"]');
      if (ed && r !== row) { ed.hidden = true; r.setAttribute("aria-expanded", "false"); }
    });
    open(willOpen);
  });

  const out = editor.querySelector("output");
  const min = Number(editor.dataset.min), max = Number(editor.dataset.max);
  editor.querySelectorAll("[data-step]").forEach((b) =>
    b.addEventListener("click", () => {
      out.value = Math.max(min, Math.min(max, Number(out.value) + Number(b.dataset.step)));
    })
  );

  if (editor.tagName === "FORM") {
    editor.addEventListener("submit", (e) => { e.preventDefault(); if (conf.save(editor)) location.reload(); });
  } else {
    editor.querySelector("[data-editor-save]").addEventListener("click", () => { if (conf.save(editor)) location.reload(); });
  }
  const auto = editor.querySelector("[data-editor-auto]");
  if (auto && conf.auto) {
    auto.textContent = "Låt appen räkna från mina loggar (" + dagar(key === "cycle" ? CYCLE.autoLength : CYCLE.autoPeriod) + ")";
    auto.addEventListener("click", () => { if (conf.auto()) location.reload(); });
  }
});
setText("[data-cycle-source]", state.settings.cycleLength ? "Eget värde" : "Räknas från dina loggar");
setText("[data-period-source]", state.settings.periodLength ? "Eget värde" : "Räknas från dina loggar");

document.querySelectorAll("[data-logout]").forEach((el) =>
  el.addEventListener("click", (e) => {
    e.preventDefault();
    Auth.logout();
    location.href = "valkommen.html";
  })
);

/* ===============================================================
   Mensperioder – används av historiken och rapporten
================================================================ */
// En period per mensstart. Längden = sista loggade mensdagen inom 10 dagar (och före nästa start).
const buildPeriods = () => starts.map((start, i) => {
  const next = starts[i + 1] || null;
  const cycleEnd = next ? addDays(next, -1) : today;
  const inCycle = state.logs
    .filter((l) => { const d = fromISO(l.date); return d && d >= start && d <= cycleEnd; })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const mensDays = inCycle.filter((l) => l.type === "mens").map((l) => daysBetween(start, fromISO(l.date))).filter((g) => g <= 10);
  const loggedLength = Math.max(0, ...mensDays) + 1;
  const estimated = loggedLength < 2;
  const sinceStart = daysBetween(start, today) + 1;
  // Pågår: senaste starten, inom vanlig menslängd och loggad fram till idag eller igår
  const ongoing = !next && sinceStart <= CYCLE.period && (estimated || loggedLength >= sinceStart - 1);
  const length = ongoing ? sinceStart : estimated ? CYCLE.period : loggedLength;
  return { start, next, length, estimated, ongoing, sinceStart, cycle: next ? daysBetween(start, next) : null, logs: inCycle };
});

/* ===============================================================
   Menshistorik: alla mensperioder med längd och cykellängd
================================================================ */
const fullHistory = document.querySelector("[data-full-history]");
if (fullHistory) {
  const range = (list) => {
    if (!list.length) return "–";
    const lo = Math.min(...list), hi = Math.max(...list);
    return lo === hi ? dagar(lo) : lo + "–" + hi + " dagar";
  };
  const avg = (list) => Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  const longDate = (d) => fmt(d, { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined }).replace(".", "");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const periods = buildPeriods();
  const earlier = state.logs.filter((l) => !starts.length || fromISO(l.date) < starts[0]);

  // Sammanfattning överst
  const measured = periods.filter((p) => !p.estimated && !p.ongoing).map((p) => p.length);
  const cycles = periods.filter((p) => p.cycle).map((p) => p.cycle);
  setText("[data-hist-period]", range(measured.length ? measured : periods.map((p) => p.length)));
  setText("[data-hist-period-avg]", measured.length ? "Snitt " + dagar(avg(measured)) + " · " + measured.length + " loggade" : "Logga varje mensdag för exaktare siffror");
  setText("[data-hist-cycle]", range(cycles));
  setText("[data-hist-cycle-avg]", cycles.length ? "Snitt " + dagar(avg(cycles)) + " · " + cycles.length + " cykler" : "Behöver minst två mensstarter");

  if (!periods.length && !earlier.length) {
    const empty = el("div", "card empty-history");
    empty.append(el("h2", null, "Ingen historik ännu"), el("p", null, "När du loggar din mens samlas den här, med hur länge den varade och hur lång cykeln var."));
    fullHistory.append(empty);
  }

  const maxCycle = Math.max(CYCLE.length, ...cycles, ...periods.map((p) => p.sinceStart));
  let year = null;
  [...periods].reverse().forEach((p) => {
    if (p.start.getFullYear() !== year) {
      year = p.start.getFullYear();
      fullHistory.append(el("h2", "year-heading", String(year)));
    }
    const card = el("article", "card period-card" + (p.ongoing ? " ongoing" : ""));
    const end = addDays(p.start, p.length - 1);

    const top = el("div", "period-top");
    top.append(el("h3", null, longDate(p.start) + " – " + (p.ongoing ? "pågår" : longDate(end))));
    top.append(el("span", "period-length", p.ongoing ? "Dag " + p.sinceStart : (p.estimated ? "ca " : "") + dagar(p.length)));
    card.append(top);

    // Stapel: mensdagar och resten av cykeln, i skala mot den längsta cykeln
    const days = p.cycle || p.sinceStart;
    const bar = el("div", "cycle-bar");
    bar.style.setProperty("--w", (days / maxCycle) * 100 + "%");
    const fill = el("span", "cb-period" + (p.estimated ? " est" : ""));
    fill.style.width = (Math.min(p.length, days) / days) * 100 + "%";
    bar.append(fill);
    bar.setAttribute("aria-hidden", "true");
    card.append(bar);

    const meta = [];
    meta.push(p.ongoing ? "Mensen pågår" : (p.estimated ? "Uppskattad längd – bara första dagen loggad" : "Mensen varade " + dagar(p.length)));
    meta.push(p.cycle ? "Cykel " + dagar(p.cycle) : "Nuvarande cykel · dag " + p.sinceStart);
    card.append(el("p", "period-meta", meta.join(" · ")));

    if (p.logs.length) {
      const ul = el("ul", "period-logs");
      p.logs.forEach((l) => {
        const d = fromISO(l.date);
        const li = el("li");
        const what = l.start ? "Mensen började" : l.type === "mens" ? "Mens · dag " + (daysBetween(p.start, d) + 1) : logLabel(l) + " · cykeldag " + (daysBetween(p.start, d) + 1);
        li.append(el("b", null, shortDate(d) + " · " + what));
        const details = logDetails(l);
        if (details) li.append(el("span", null, details));
        ul.append(li);
      });
      card.append(ul);
    }
    fullHistory.append(card);
  });

  if (earlier.length) {
    fullHistory.append(el("h2", "year-heading", "Före första mensstarten"));
    const card = el("article", "card period-card");
    const ul = el("ul", "period-logs");
    [...earlier].sort((a, b) => (a.date < b.date ? 1 : -1)).forEach((l) => {
      const li = el("li");
      li.append(el("b", null, longDate(fromISO(l.date)) + " · " + logLabel(l)));
      const details = logDetails(l);
      if (details) li.append(el("span", null, details));
      ul.append(li);
    });
    card.append(ul);
    fullHistory.append(card);
  }
}

/* ===============================================================
   Profil: exportera mina data till en fil (efter att man svarat ja)
================================================================ */
const exportOpen = document.querySelector("[data-export-open]");
const exportSheet = document.querySelector("#export-sheet");
if (exportOpen && exportSheet) {
  const sheet = makeSheet(exportSheet, exportOpen);
  const step = (name) => {
    exportSheet.querySelectorAll("[data-export-step]").forEach((el) => (el.hidden = el.dataset.exportStep !== name));
    exportSheet.querySelector('[data-export-step="' + name + '"] .sheet-title').focus();
  };
  const n = state.logs.length;
  exportSheet.querySelectorAll("[data-export-count-logs]").forEach((el) => (el.textContent = n === 1 ? "1 loggning" : n + " loggningar"));
  const format = () => (exportSheet.querySelector('input[name="export-format"]:checked') || {}).value || "rapport";
  exportSheet.querySelectorAll('input[name="export-format"]').forEach((r) =>
    r.addEventListener("change", () =>
      exportSheet.querySelectorAll("[data-export-for]").forEach((el) => (el.hidden = el.dataset.exportFor !== format()))
    )
  );

  // Allt som sparats om användaren – utan namn, e-post, adress och lösenord
  const buildExport = () => {
    const label = (list, id) => (id ? optionLabel(list, id) || id : null);
    const productName = (id) => (PRODUCTS.find((p) => p.id === id) || {}).name || id;
    return {
      app: "Blomstra",
      exporterad: new Date().toISOString(),
      profil: {
        alder: state.profile.age,
        preventivmedel: label("contraception", state.profile.contraception),
        mensskydd: state.profile.protection.map((id) => label("protection", id)),
      },
      cykel: {
        cykellangd: state.settings.cycleLength || null,
        cykellangdRaknasAvAppen: !state.settings.cycleLength,
        menslangd: state.settings.periodLength || null,
        menslangdRaknasAvAppen: !state.settings.periodLength,
        snittcykelJustNu: CYCLE.length,
        menslangdJustNu: CYCLE.period,
      },
      loggningar: [...state.logs]
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((l) => ({
          datum: l.date,
          typ: l.type,
          mensenBorjade: !!l.start,
          blodning: l.flow || null,
          symtom: l.symptoms || [],
          ...(l.type === "sex" ? { skydd: l.protection || null } : {}),
          anteckning: l.note || null,
        })),
      egnaSymtom: state.customSymptoms,
      paket: {
        produkter: Object.entries(state.package.items).map(([id, antal]) => ({ produkt: productName(id), antal })),
        totalt: packageTotal() + " kr",
        narViFragar: whenLabel(),
        onskatLeveransdatum: state.package.deliveryDate || null,
      },
      // Leveransen utan adressen
      leverans: state.delivery ? (({ address, ...rest }) => rest)(state.delivery) : null,
      paminnelser: state.prefs,
      svarRackteDittPaket: state.feedback,
      kronblad: { samlade: kronblad(), skickadeLeveranser: (state.orders || []).map((o) => o.date), valdaBelöningar: (state.rewards || []).map((r) => ({ belöning: r.name, datum: r.date })) },
    };
  };

  // Lättläst rapport (HTML) – bara hälsouppgifter. Inget namn, ingen e-post, ingen adress.
  const buildReport = () => {
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const date = (d) => fmt(d, { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
    const avg = (list) => Math.round(list.reduce((a, b) => a + b, 0) / list.length);
    const span = (list) => { const lo = Math.min(...list), hi = Math.max(...list); return lo === hi ? dagar(lo) : lo + "–" + hi + " dagar"; };
    const row = (label, value) => "<tr><th scope=\"row\">" + esc(label) + "</th><td>" + esc(value) + "</td></tr>";
    const none = "Inte angivet";

    const periods = buildPeriods();
    const measured = periods.filter((p) => !p.estimated && !p.ongoing).map((p) => p.length);
    const cycles = periods.filter((p) => p.cycle).map((p) => p.cycle);
    const last = periods[periods.length - 1];
    const prot = state.profile.protection.map((id) => optionLabel("protection", id)).filter(Boolean).join(", ");

    const about = [
      row("Ålder", state.profile.age ? state.profile.age + " år" : none),
      row("Preventivmedel", optionLabel("contraception", state.profile.contraception) || none),
      row("Mensskydd", prot || none),
    ].join("");

    const summary = [
      row("Cykellängd", dagar(CYCLE.length) + (state.settings.cycleLength ? " (angiven av mig)" : cycles.length ? " (snitt av loggade cykler)" : " (standardvärde, för få loggningar)")),
      cycles.length ? row("Cykellängd, variation", span(cycles) + " · " + cycles.length + (cycles.length === 1 ? " cykel" : " cykler")) : "",
      row("Menslängd", dagar(CYCLE.period) + (state.settings.periodLength ? " (angiven av mig)" : measured.length ? " (snitt av loggade mensperioder)" : " (standardvärde, för få loggningar)")),
      measured.length ? row("Menslängd, variation", span(measured)) : "",
      row("Senaste mens började", last ? date(last.start) : "Inte loggad"),
      row("Nästa mens beräknas", !CYCLE.hasData ? "Kan inte beräknas – ingen mens loggad"
        : CYCLE.daysLate ? "Mensen är ca " + dagar(CYCLE.daysLate) + " sen (uppskattning)"
        : date(nextPeriod) + " (uppskattning)"),
      row("Antal loggade mensperioder", String(periods.length)),
    ].join("");

    const periodRows = [...periods].reverse().map((p) => {
      const end = addDays(p.start, p.length - 1);
      return "<tr><td>" + esc(date(p.start)) + "</td><td>" + esc(p.ongoing ? "pågår" : date(end)) + "</td><td>" +
        esc(p.ongoing ? "dag " + p.sinceStart : (p.estimated ? "ca " : "") + dagar(p.length)) + "</td><td>" +
        esc(p.cycle ? dagar(p.cycle) : "nuvarande cykel") + "</td></tr>";
    }).join("");

    const counts = {};
    state.logs.forEach((l) => (l.symptoms || []).forEach((sy) => (counts[sy] = (counts[sy] || 0) + 1)));
    const symptomRows = Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([sy, c]) => "<tr><td>" + esc(sy) + "</td><td>" + c + (c === 1 ? " gång" : " gånger") + "</td></tr>").join("");

    const logRows = [...state.logs].sort((a, b) => (a.date < b.date ? 1 : -1)).map((l) => {
      const d = fromISO(l.date);
      const type = logLabel(l);
      return "<tr><td>" + esc(d ? date(d) : l.date) + "</td><td>" + esc(type) + "</td><td>" + esc(l.flow || "–") + "</td><td>" +
        esc((l.symptoms || []).join(", ") || l.protection || "–") + "</td><td>" + esc(l.note || "–") + "</td></tr>";
    }).join("");

    const table = (head, rows, empty) => rows
      ? "<table><thead><tr>" + head.map((h) => "<th scope=\"col\">" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" + rows + "</tbody></table>"
      : "<p class=\"empty\">" + esc(empty) + "</p>";

    return "<!doctype html>\n<html lang=\"sv\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>Menshistorik – rapport från Blomstra</title><style>" +
      "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#2b1a20;background:#fff;margin:0;padding:24px 16px 40px;line-height:1.45}" +
      "main{max-width:760px;margin:0 auto}h1{color:#8b1e3f;font-size:26px;margin:0 0 4px}.sub{color:#6b5a60;margin:0 0 24px;font-size:14px}" +
      "h2{color:#8b1e3f;font-size:18px;margin:28px 0 8px;padding-bottom:4px;border-bottom:2px solid #f3c6d6}" +
      "table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #f0dde4;vertical-align:top}" +
      "thead th{background:#fdeef3;font-weight:600}tbody th{font-weight:500;color:#6b5a60;width:45%}.empty{color:#6b5a60;font-style:italic}" +
      ".scroll{overflow-x:auto}.note{margin-top:32px;font-size:12.5px;color:#6b5a60;border-top:1px solid #f0dde4;padding-top:12px}" +
      "@media print{body{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}" +
      "</style></head><body><main>" +
      "<h1>Menshistorik</h1><p class=\"sub\">Rapport från Blomstra · skapad " + esc(date(new Date())) + "</p>" +
      "<h2>Om mig</h2><table><tbody>" + about + "</tbody></table>" +
      "<h2>Sammanfattning</h2><table><tbody>" + summary + "</tbody></table>" +
      "<h2>Mensperioder</h2><div class=\"scroll\">" + table(["Började", "Slutade", "Mensens längd", "Cykellängd"], periodRows, "Inga mensperioder loggade ännu.") + "</div>" +
      "<h2>Vanligaste symtom</h2>" + table(["Symtom", "Loggat"], symptomRows, "Inga symtom loggade.") +
      "<h2>Alla loggningar</h2><div class=\"scroll\">" + table(["Datum", "Typ", "Blödning", "Symtom", "Anteckning"], logRows, "Inga loggningar ännu.") + "</div>" +
      "<p class=\"note\">Uppgifterna är loggade av användaren själv i Blomstra. Cykel- och menslängd samt nästa mens är uppskattningar, inte en medicinsk bedömning. " +
      "Rapporten innehåller inget namn, ingen e-post och ingen adress.</p>" +
      "</main></body></html>\n";
  };

  exportOpen.addEventListener("click", () => { sheet.open(); step("ask"); });
  exportSheet.querySelector("[data-export-yes]").addEventListener("click", () => {
    const report = format() === "rapport";
    const name = (report ? "blomstra-rapport-" : "blomstra-data-") + toISO(new Date()) + (report ? ".html" : ".json");
    const blob = report
      ? new Blob([buildReport()], { type: "text/html" })
      : new Blob([JSON.stringify(buildExport(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    exportSheet.querySelector("[data-export-filename]").textContent = name;
    exportSheet.querySelector("[data-export-tip]").hidden = !report;
    step("done");
  });
}

/* ===============================================================
   Kronblad: poäng.
   + 1 för varje leverans man skickar via appen
   + 1 när man svarar på "Räckte ditt paket?" (ett svar per leverans räknas)
   10 kronblad = en full blomma = välj en belöning.
================================================================ */
const KRONBLAD_GOAL = 10;
const REWARDS = [
  { id: "produkt", name: "En gratis produkt", desc: "Välj valfri produkt i ditt nästa paket utan kostnad.", img: "bilder/beloning-produkt.jpg" },
  { id: "menstrosor", name: "Menstrosor", desc: "Ett par menstrosor som skickas med ditt nästa paket.", img: "bilder/beloning-menstrosor.jpg" },
  { id: "varmekudde", name: "Värmekudde", desc: "En liten värmekudde mot mensvärk, skickas med nästa paket.", img: "bilder/beloning-varmekudde.jpg" },
  { id: "te", name: "Te för mensen", desc: "En ask örtte med ingefära och kamomill i nästa paket.", img: "bilder/beloning-te.jpg" },
  { id: "choklad", name: "Mörk choklad", desc: "En liten chokladkaka i ditt nästa paket.", img: "bilder/beloning-choklad.jpg" },
  { id: "intimtval", name: "Intimtvål", desc: "En mild, oparfymerad intimtvål i ditt nästa paket." },
  { id: "intimservetter", name: "Intimservetter", desc: "En förpackning intimservetter att ha i väskan." },
  { id: "intimdeo", name: "Intimdeo", desc: "En mild intimdeo som skickas med ditt nästa paket." },
  { id: "varmeplaster", name: "Värmeplåster", desc: "Värmeplåster mot mensvärk att ha när du är på språng." },
  { id: "mysstrumpor", name: "Mysstrumpor", desc: "Ett par mjuka mysstrumpor för lugna mensdagar." },
  { id: "badbomb", name: "Badbomb", desc: "En doftande badbomb för ett avslappnande bad." },
  { id: "lappbalsam", name: "Läppbalsam", desc: "Ett läppbalsam som skickas med ditt nästa paket." },
];
function kronbladEarned() {
  const welcome = 2; // välkomstgåva: alla konton börjar med två kronblad
  const orders = (state.orders || []).length;
  const answers = (state.feedback || []).length;
  return welcome + orders + Math.min(answers, orders);
}
const kronblad = () => Math.max(0, kronbladEarned() - (state.rewards || []).length * KRONBLAD_GOAL);

const flower = document.querySelector("[data-flower]");
if (flower) {
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => { const n = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); return n; };
  const total = kronblad();
  const shown = Math.min(total, KRONBLAD_GOAL);
  const full = shown >= KRONBLAD_GOAL;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Droppformat kronblad: spetsen mot mitten, rund ände utåt. Roteras 36° per blad.
  const PETAL = "M0 -38C-7 -46 -17 -55 -17 -68A17 17 0 1 1 17 -68C17 -55 7 -46 0 -38Z";
  for (let i = 0; i < KRONBLAD_GOAL; i++) {
    const g = svgEl("g", { transform: "translate(100 100) rotate(" + i * 36 + ")" });
    const p = svgEl("path", { d: PETAL, class: "petal" + (i < shown ? " on" : "") });
    if (i < shown && !reduced) p.style.animationDelay = i * 70 + "ms";
    g.append(p);
    flower.append(g);
  }
  flower.append(svgEl("circle", { cx: 100, cy: 100, r: 27, class: "flower-center" }));
  const num = svgEl("text", { x: 100, y: 101, class: "flower-num", "text-anchor": "middle", "dominant-baseline": "central" });
  num.textContent = shown;
  flower.append(num);
  flower.setAttribute("aria-label", shown + " av " + KRONBLAD_GOAL + " kronblad");
  flower.classList.toggle("full", full);

  setText("[data-kb-status]", shown + " av " + KRONBLAD_GOAL + " kronblad");
  // Nya kronblad sedan förra besöket lyser till, och notisen på kronbladet nollställs
  const unseen = kronbladUnseen();
  [...flower.querySelectorAll(".petal.on")].slice(Math.max(0, shown - unseen)).forEach((p) => p.classList.add("new"));
  const welcomeNote = document.querySelector("[data-kb-welcome]");
  if (welcomeNote) welcomeNote.hidden = (state.kronbladSeen || 0) > 0;
  if (unseen) { state.kronbladSeen = kronbladEarned(); saveState(); updateKronbladBadge(); }
  const left = KRONBLAD_GOAL - shown;
  setText("[data-kb-sub]", full ? "Blomman är full – välj en belöning nedan!" : (left === 1 ? "1 kronblad" : left + " kronblad") + " kvar till en belöning");
  const saved = document.querySelector("[data-kb-saved]");
  if (total > KRONBLAD_GOAL) { saved.hidden = false; saved.textContent = "+ " + (total - KRONBLAD_GOAL) + " sparade till nästa blomma"; }

  // Belöningar – går att välja först när blomman är full
  const list = document.querySelector("[data-reward-list]");
  const sheetEl = document.querySelector("#reward-sheet");
  let chosen = null;
  const sheets = new Map(); // en ruta per knapp så att fokus går tillbaka rätt
  const step = (name) => {
    sheetEl.querySelectorAll("[data-reward-step]").forEach((el) => (el.hidden = el.dataset.rewardStep !== name));
    sheetEl.querySelector('[data-reward-step="' + name + '"] .sheet-title').focus();
  };
  setText("[data-reward-count]", "· " + REWARDS.length + " att välja bland");
  REWARDS.forEach((r) => {
    const li = document.createElement("li");
    li.className = "reward" + (full ? " ready" : "");
    const text = document.createElement("div");
    const b = document.createElement("b"); b.textContent = r.name;
    const sm = document.createElement("small"); sm.textContent = r.desc;
    text.append(b, sm);
    // Rund bild – eller ett kronblad som platshållare tills det finns en bild
    let icon;
    if (r.img) {
      icon = document.createElement("img");
      icon.src = r.img;
      icon.alt = "";
      icon.width = 50;
      icon.height = 50;
      icon.loading = "lazy";
    } else {
      icon = svgEl("svg", { viewBox: "-20 -90 40 56", "aria-hidden": "true" });
      icon.append(svgEl("path", { d: PETAL }));
    }
    icon.classList.add("reward-img");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reward-btn";
    btn.textContent = full ? "Välj" : "10 kronblad";
    btn.disabled = !full;
    btn.setAttribute("aria-label", full ? "Välj " + r.name : r.name + " – kräver 10 kronblad");
    btn.addEventListener("click", () => {
      chosen = r;
      if (!sheets.has(btn)) sheets.set(btn, makeSheet(sheetEl, btn));
      const sheet = sheets.get(btn);
      sheetEl.querySelector("[data-reward-name]").textContent = r.name.toLowerCase();
      sheetEl.querySelector("[data-reward-desc]").textContent = r.desc;
      sheet.open(); step("ask");
    });
    li.append(icon, text, btn);
    list.append(li);
  });
  sheetEl.querySelector("[data-reward-yes]").addEventListener("click", () => {
    if (!chosen || kronblad() < KRONBLAD_GOAL) return;
    state.rewards = [...(state.rewards || []), { id: chosen.id, name: chosen.name, date: toISO(today) }];
    saveState();
    sheetEl.querySelector("[data-reward-done]").textContent = chosen.name + " skickas med ditt nästa paket. Nu börjar du samla på en ny blomma.";
    step("done");
    // Ladda om sidan när rutan stängs så att blomman börjar om
    sheetEl.querySelectorAll("[data-sheet-close]").forEach((el) => el.addEventListener("click", () => location.reload(), { once: true }));
  });

  // Valda belöningar
  const mine = state.rewards || [];
  if (mine.length) {
    document.querySelector("[data-my-rewards-wrap]").hidden = false;
    const ul = document.querySelector("[data-my-rewards]");
    [...mine].reverse().forEach((r) => {
      const li = document.createElement("li");
      li.className = "row";
      const v = document.createElement("span");
      v.className = "value";
      v.textContent = shortDate(fromISO(r.date));
      li.append(r.name, v);
      ul.append(li);
    });
  }
}

/* ---------- Notis på kronbladet: hur många nya kronblad man fått sedan man tittade senast ---------- */
function kronbladUnseen() {
  return Math.max(0, kronbladEarned() - (state.kronbladSeen || 0));
}
function updateKronbladBadge() {
  const n = kronbladUnseen();
  document.querySelectorAll(".kronblad-badge").forEach((a) => {
    let dot = a.querySelector(".kb-notis");
    if (!n) {
      if (dot) dot.remove();
      a.setAttribute("aria-label", "Kronblad – dina poäng");
      return;
    }
    if (!dot) {
      dot = document.createElement("b");
      dot.className = "kb-notis";
      dot.setAttribute("aria-hidden", "true");
      a.append(dot);
    }
    const text = "+" + n;
    if (dot.textContent && dot.textContent !== text) {
      dot.classList.remove("pop");
      void dot.offsetWidth; // starta om animationen
    }
    dot.textContent = text;
    dot.classList.add("pop");
    a.setAttribute("aria-label", "Kronblad – " + (n === 1 ? "1 nytt kronblad" : n + " nya kronblad"));
  });
}
updateKronbladBadge();
