// Blomstra – konton och inloggning
// OBS: allt sparas bara lokalt i webbläsaren på den här enheten. Det här är en prototyp,
// inte en riktig inloggning – en riktig app behöver en server som lagrar konton säkert.

const APP_TODAY = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })(); // dagens datum (midnatt)

const Auth = (() => {
  const USERS = "mensappen-users";
  const SESSION = "mensappen-session";
  const LEGACY = "mensappen-v1"; // data från innan det fanns konton

  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const del = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
  const readJSON = (k, fallback) => { try { return JSON.parse(get(k)) || fallback; } catch (e) { return fallback; } };

  const norm = (email) => String(email || "").trim().toLowerCase();
  const users = () => readJSON(USERS, {});
  const saveUsers = (all) => set(USERS, JSON.stringify(all));
  const currentEmail = () => get(SESSION);
  const current = () => { const e = currentEmail(); return (e && users()[e]) || null; };
  const stateKey = () => LEGACY + ":" + currentEmail();

  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const newSalt = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); };
  // Lösenordet sparas aldrig i klartext, bara som saltad SHA-256
  const hash = async (password, salt) => {
    const data = new TextEncoder().encode(salt + ":" + password);
    if (crypto.subtle) return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
    let h = 2166136261; // reserv om webbläsaren saknar crypto.subtle
    for (const b of data) { h ^= b; h = Math.imul(h, 16777619); }
    return "fnv" + (h >>> 0).toString(16);
  };

  return {
    current,
    stateKey,

    async register({ name, email, password }) {
      const key = norm(email);
      const all = users();
      if (all[key]) throw new Error("exists");
      const salt = newSalt();
      all[key] = {
        name: name.trim(),
        email: email.trim(),
        salt,
        hash: await hash(password, salt),
        created: new Date().toISOString(),
        onboarded: false,
      };
      if (!saveUsers(all)) throw new Error("storage");
      set(SESSION, key);
      // Första kontot tar över det som sparats innan konton fanns
      const legacy = get(LEGACY);
      if (Object.keys(all).length === 1 && legacy) {
        try {
          const s = JSON.parse(legacy);
          s.packageSaved = true;
          set(stateKey(), JSON.stringify(s));
          del(LEGACY);
        } catch (e) {}
      }
      return all[key];
    },

    async login(email, password) {
      const key = norm(email);
      const user = users()[key];
      if (!user || (await hash(password, user.salt)) !== user.hash) throw new Error("invalid");
      set(SESSION, key);
      return user;
    },

    logout() { del(SESSION); },

    update(fields) {
      const key = currentEmail();
      const all = users();
      if (!all[key]) return false;
      Object.assign(all[key], fields);
      return saveUsers(all);
    },

    // Raderar kontot och all data som hör till det
    remove() {
      const key = currentEmail();
      const all = users();
      delete all[key];
      saveUsers(all);
      del(stateKey());
      del(SESSION);
    },

    loadState() { return readJSON(stateKey(), null); },
    saveState(state) { return set(stateKey(), JSON.stringify(state)); },
  };
})();

// Sidor utan data-public kräver inloggning
(() => {
  const root = document.documentElement;
  const page = location.pathname.split("/").pop() || "index.html";
  const user = Auth.current();
  if (!root.hasAttribute("data-public") && !user) location.replace("valkommen.html");
  else if (user && (page === "valkommen.html" || page === "loggain.html")) location.replace("index.html");
  else if (user && user.onboarded && page === "registrera.html") location.replace("index.html");
})();

/* ---------- Svarsalternativ i registreringen och profilen ---------- */
const PROFILE_OPTIONS = {
  contraception: [
    { id: "inget", label: "Inget" },
    { id: "kondom", label: "Kondom" },
    { id: "p-piller", label: "P-piller", hormonal: true },
    { id: "minipiller", label: "Minipiller", hormonal: true },
    { id: "hormonspiral", label: "Hormonspiral", hormonal: true },
    { id: "kopparspiral", label: "Kopparspiral" },
    { id: "p-stav", label: "P-stav", hormonal: true },
    { id: "p-ring", label: "P-ring eller p-plåster", hormonal: true },
    { id: "p-spruta", label: "P-spruta", hormonal: true },
    { id: "annat", label: "Annat" },
  ],
  protection: [
    { id: "bindor", label: "Bindor", product: "bindor-dag" },
    { id: "tamponger", label: "Tamponger", product: "tamponger" },
    { id: "menskopp", label: "Menskopp", product: "rengoring" },
    { id: "menstrosor", label: "Menstrosor" },
    { id: "trosskydd", label: "Trosskydd", product: "trosskydd" },
  ],
};
const optionLabel = (list, id) => (PROFILE_OPTIONS[list].find((o) => o.id === id) || {}).label;

/* ---------- Användarens sparade data ---------- */
const newUserState = () => ({
  package: { items: { "bindor-dag": 1, trosskydd: 1, toapapper: 1 }, when: "cycle", interval: 1 },
  logs: [],
  customSymptoms: [],
  prefs: { periodReminder: true, cupReminder: true, symptomReminder: false },
  settings: { cycleLength: null, periodLength: null }, // null = appen räknar från loggarna
  profile: { age: null, contraception: null, protection: [] },
  delivery: null,
  feedback: [],
});
const loadUserState = () => {
  const d = newUserState();
  const saved = Auth.loadState() || {};
  return {
    ...d,
    ...saved,
    prefs: { ...d.prefs, ...(saved.prefs || {}) },
    settings: { ...d.settings, ...(saved.settings || {}) },
    profile: { ...d.profile, ...(saved.profile || {}) },
  };
};
