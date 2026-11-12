// Blomstra – logga in, skapa konto och frågorna vid registreringen
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const isoDate = (d) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseISO = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
const shortSv = (d) => d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(".", "");

/* ---------- Visa/dölj lösenord ---------- */
$$("[data-pw-toggle]").forEach((btn) => {
  const input = document.getElementById(btn.getAttribute("aria-controls"));
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Dölj" : "Visa";
    btn.setAttribute("aria-pressed", String(show));
  });
});

const formError = (form, msg, field) => {
  $("[data-form-error]", form).textContent = msg;
  $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
  if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
};

/* ---------- Logga in ---------- */
const loginForm = $("[data-login-form]");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginForm.email, password = loginForm.password;
    if (!email.value.trim()) return formError(loginForm, "Skriv din e-post.", email);
    if (!password.value) return formError(loginForm, "Skriv ditt lösenord.", password);
    try {
      await Auth.login(email.value, password.value);
      location.href = "index.html";
    } catch (err) {
      formError(loginForm, "Fel e-post eller lösenord.", password);
    }
  });
}

/* ---------- Skapa konto och frågor ---------- */
const registerForm = $("[data-register-form]");
if (registerForm) {
  const steps = $$("[data-ob-step]");
  const order = steps.map((s) => s.dataset.obStep);
  const questions = steps.filter((s) => s.hasAttribute("data-question")).map((s) => s.dataset.obStep);
  const back = $("[data-ob-back]");
  const skipAll = $("[data-ob-skip-all]");
  const progress = $("[data-ob-progress]");
  let current = "account";
  let state = null;

  // Fyll i svarsalternativen
  const ageSelect = $("[data-age-select]");
  for (let a = 12; a <= 60; a++) ageSelect.append(new Option(a + " år", a));

  const contraList = $("[data-contraception-options]");
  PROFILE_OPTIONS.contraception.forEach((o) => {
    const label = document.createElement("label");
    label.className = "row radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "contraception";
    input.value = o.id;
    label.append(input, " " + o.label);
    contraList.append(label);
  });

  const chips = $("[data-protection-options]");
  PROFILE_OPTIONS.protection.forEach((o) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = o.id;
    chip.setAttribute("aria-pressed", "false");
    chip.textContent = o.label;
    chip.addEventListener("click", () => chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true")));
    chips.append(chip);
  });

  $$(".ob-stepper").forEach((st) => {
    const out = $("output", st);
    $$("[data-step]", st).forEach((b) =>
      b.addEventListener("click", () => {
        out.value = Math.max(+st.dataset.min, Math.min(+st.dataset.max, +out.value + +b.dataset.step));
      })
    );
  });

  const lastInput = $("[data-last-date]");
  lastInput.max = isoDate(APP_TODAY);
  lastInput.min = isoDate(new Date(APP_TODAY.getFullYear(), APP_TODAY.getMonth(), APP_TODAY.getDate() - 90));

  // Spara svaret som mensstart. Svaret går före en tidigare start inom 10 dagar (samma mens).
  const addStart = (date) => {
    const iso = isoDate(date);
    state.logs.forEach((l) => {
      if (l.start && l.date !== iso && Math.abs(Math.round((parseISO(l.date) - date) / 86400000)) <= 10) l.start = false;
    });
    const same = state.logs.find((l) => l.date === iso && l.type === "mens");
    if (same) same.start = true;
    else state.logs.push({ id: String(Date.now()), date: iso, type: "mens", start: true, flow: "", symptoms: [], note: "" });
  };
  const lastStart = () => {
    const s = state.logs.filter((l) => l.start).map((l) => l.date).sort();
    return s.length ? parseISO(s[s.length - 1]) : null;
  };

  // Vad som visas och sparas för varje fråga
  const Q = {
    age: {
      fill: () => (ageSelect.value = state.profile.age || ""),
      save: () => (state.profile.age = Number(ageSelect.value) || null),
      skip: () => (state.profile.age = null),
    },
    cycle: {
      fill: (sec) => ($("output", sec).value = state.settings.cycleLength || 28),
      save: (sec) => (state.settings.cycleLength = Number($("output", sec).value)),
      skip: () => (state.settings.cycleLength = null),
    },
    period: {
      fill: (sec) => ($("output", sec).value = state.settings.periodLength || 5),
      save: (sec) => (state.settings.periodLength = Number($("output", sec).value)),
      skip: () => (state.settings.periodLength = null),
    },
    last: {
      fill: () => { const d = lastStart(); lastInput.value = d ? isoDate(d) : ""; },
      save: () => {
        const d = parseISO(lastInput.value);
        if (d && d <= APP_TODAY) addStart(d);
      },
      skip: () => {},
    },
    contraception: {
      fill: () => $$("input", contraList).forEach((i) => (i.checked = i.value === state.profile.contraception)),
      save: () => { const c = $("input:checked", contraList); state.profile.contraception = c ? c.value : null; },
      skip: () => (state.profile.contraception = null),
    },
    protection: {
      fill: () => $$(".chip", chips).forEach((c) => c.setAttribute("aria-pressed", String(state.profile.protection.includes(c.dataset.value)))),
      save: () => {
        state.profile.protection = $$('.chip[aria-pressed="true"]', chips).map((c) => c.dataset.value);
        // Föreslå ett paket utifrån valen, om man inte redan satt ihop ett eget
        const items = {};
        state.profile.protection.forEach((id) => {
          const p = PROFILE_OPTIONS.protection.find((o) => o.id === id);
          if (p && p.product) items[p.product] = 1;
        });
        if (!state.packageSaved && Object.keys(items).length) state.package.items = items;
      },
      skip: () => (state.profile.protection = []),
    },
  };

  const show = (key) => {
    current = key;
    steps.forEach((s) => (s.hidden = s.dataset.obStep !== key));
    const sec = $('[data-ob-step="' + key + '"]');
    const qi = questions.indexOf(key);
    progress.hidden = qi < 0;
    skipAll.hidden = qi < 0;
    if (qi >= 0) {
      $("span", progress).style.width = ((qi + 1) / questions.length) * 100 + "%";
      progress.setAttribute("aria-label", "Fråga " + (qi + 1) + " av " + questions.length);
      Q[key].fill(sec);
    }
    // Tillbaka: till välkomstsidan från kontosteget, annars föregående fråga
    back.hidden = key === "intro" || key === "done";
    back.href = key === "account" ? "valkommen.html" : "#";
    $$("[data-ob-name]").forEach((el) => (el.textContent = (Auth.current() || {}).name || ""));
    const h = $("h1", sec);
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  };
  const next = () => show(order[order.indexOf(current) + 1]);

  back.addEventListener("click", (e) => {
    if (current === "account") return;
    e.preventDefault();
    show(order[order.indexOf(current) - 1]);
  });

  const summaryRow = (label, value) => {
    const li = document.createElement("li");
    li.className = "row";
    const v = document.createElement("span");
    v.className = "value";
    v.textContent = value;
    li.append(label, v);
    return li;
  };
  const finish = () => {
    Auth.saveState(state);
    Auth.update({ onboarded: true });
    const auto = "Appen räknar själv";
    const last = lastStart();
    const prot = state.profile.protection.map((id) => optionLabel("protection", id)).join(", ");
    $("[data-ob-summary]").replaceChildren(
      summaryRow("Ålder", state.profile.age ? state.profile.age + " år" : "Inte angiven"),
      summaryRow("Cykellängd", state.settings.cycleLength ? state.settings.cycleLength + " dagar" : auto),
      summaryRow("Menslängd", state.settings.periodLength ? state.settings.periodLength + " dagar" : auto),
      summaryRow("Senaste mens", last ? shortSv(last) : "Logga när den kommer"),
      summaryRow("Preventivmedel", optionLabel("contraception", state.profile.contraception) || "Inte angivet"),
      summaryRow("Mensskydd", prot || "Inte angivet")
    );
    show("done");
  };

  $$("[data-ob-next]").forEach((b) =>
    b.addEventListener("click", () => {
      const sec = $('[data-ob-step="' + current + '"]');
      if (Q[current]) { Q[current].save(sec); Auth.saveState(state); }
      if (current === questions[questions.length - 1]) finish();
      else next();
    })
  );
  $$("[data-ob-skip]").forEach((b) =>
    b.addEventListener("click", () => {
      Q[current].skip();
      Auth.saveState(state);
      if (current === questions[questions.length - 1]) finish();
      else next();
    })
  );
  $$("[data-ob-finish]").forEach((b) => b.addEventListener("click", finish));
  skipAll.addEventListener("click", finish);

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = registerForm;
    if (!f.name.value.trim()) return formError(f, "Skriv ditt förnamn.", f.name);
    if (!f.email.value.trim() || !f.email.checkValidity()) return formError(f, "Skriv en giltig e-postadress.", f.email);
    if (f.password.value.length < 8) return formError(f, "Lösenordet behöver vara minst 8 tecken.", f.password);
    try {
      await Auth.register({ name: f.name.value, email: f.email.value, password: f.password.value });
    } catch (err) {
      return formError(
        f,
        err.message === "exists" ? "Det finns redan ett konto med den e-posten. Logga in i stället." : "Kunde inte skapa kontot på den här enheten.",
        err.message === "exists" ? f.email : null
      );
    }
    state = loadUserState();
    show("intro");
  });

  // Inloggad men inte klar med frågorna: fortsätt där
  if (Auth.current()) {
    state = loadUserState();
    show("intro");
  }
}
