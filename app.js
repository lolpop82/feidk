(function () {
  // --- Theme toggle ---
  const themeBtn = document.getElementById("theme-toggle");
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.add("light");
    themeBtn.textContent = "Dark";
  }
  themeBtn.addEventListener("click", () => {
    document.body.classList.toggle("light");
    const isLight = document.body.classList.contains("light");
    themeBtn.textContent = isLight ? "Dark" : "Light";
    localStorage.setItem("theme", isLight ? "light" : "dark");
  });

  // --- State ---
  let selectedGame = null;
  let freeUnits = [];
  let allUnits = []; // combined list of all units (free + draftable)
  let pickRates = {}; // name -> rate
  let drafters = []; // ["Player", "Bot 1", ...]
  let draftOrder = []; // sequence of drafter indices for entire draft
  let draftPicks = {}; // drafterIndex -> [unit names]
  let available = []; // remaining unit names
  let currentPick = 0;
  let playerIndex = 0;

  // --- DOM refs ---
  const screens = {
    select: document.getElementById("screen-select"),
    setup: document.getElementById("screen-setup"),
    draft: document.getElementById("screen-draft"),
    results: document.getElementById("screen-results"),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  // --- Game Select ---
  function renderGameList() {
    const container = document.getElementById("game-list");
    container.innerHTML = "";
    GAMES.forEach((game, i) => {
      const card = document.createElement("div");
      card.className = "game-card" + (game.units.length === 0 ? " empty" : "");
      const count =
        game.units.length > 0
          ? `${game.units.length} units`
          : "No units configured yet";
      card.innerHTML = `<h3>${game.name}</h3><div class="unit-count">${count}</div>`;
      if (game.units.length > 0) {
        card.addEventListener("click", () => selectGame(i));
      }
      container.appendChild(card);
    });
  }

  function selectGame(index) {
    selectedGame = index;
    const game = GAMES[index];
    // Deep copy free units and build combined unit list
    freeUnits = [...game.freeUnits];
    pickRates = {};
    game.units.forEach((u) => (pickRates[u.name] = u.pickRate));
    game.freeUnits.forEach((name) => {
      if (!(name in pickRates)) pickRates[name] = 50;
    });
    allUnits = [...new Set([...game.freeUnits, ...game.units.map((u) => u.name)])];
    renderSetup();
    showScreen("setup");
  }

  // --- Setup Screen ---
  function renderSetup() {
    const game = GAMES[selectedGame];
    document.getElementById("setup-game-name").textContent = game.name;
    document.getElementById("num-bots").value = 3;
    document.getElementById("num-rounds").value = 7;
    document.getElementById("draft-type").value = "snake";
    updatePositionOptions();
    renderFreeUnits();
    renderPickRates();
  }

  function updatePositionOptions() {
    const numBots = parseInt(document.getElementById("num-bots").value) || 1;
    const sel = document.getElementById("player-position");
    const total = numBots + 1;
    sel.innerHTML = "";
    for (let i = 1; i <= total; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i + (i === 1 ? "st" : i === 2 ? "nd" : i === 3 ? "rd" : "th");
      sel.appendChild(opt);
    }
  }

  function renderFreeUnits() {
    const container = document.getElementById("free-unit-tags");
    container.innerHTML = "";
    freeUnits.forEach((name) => {
      const tag = document.createElement("span");
      tag.className = "free-tag";
      tag.innerHTML = `${name} <button data-name="${name}">&times;</button>`;
      container.appendChild(tag);
    });

    // Populate add-free dropdown with non-free units
    const addSel = document.getElementById("add-free-select");
    addSel.innerHTML = '<option value="">-- Add unit --</option>';
    allUnits.forEach((name) => {
      if (!freeUnits.includes(name)) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        addSel.appendChild(opt);
      }
    });
  }

  function renderPickRates() {
    const container = document.getElementById("pick-rate-grid");
    container.innerHTML = "";
    allUnits.forEach((name) => {
      if (freeUnits.includes(name)) return;
      const div = document.createElement("div");
      div.className = "pick-rate-item";
      div.innerHTML = `<span>${name}</span><input type="number" min="1" max="100" value="${pickRates[name]}" data-unit="${name}">`;
      container.appendChild(div);
    });
  }

  // --- Draft Logic ---
  function buildDraftOrder(numDrafters, numRounds, type, playerPos) {
    const order = [];
    for (let r = 0; r < numRounds; r++) {
      const roundOrder = [];
      for (let d = 0; d < numDrafters; d++) roundOrder.push(d);
      if (type === "snake" && r % 2 === 1) roundOrder.reverse();
      order.push(...roundOrder);
    }
    return order;
  }

  function weightedRandomPick(units, rates) {
    const totalWeight = units.reduce((sum, name) => sum + (rates[name] || 1), 0);
    let r = Math.random() * totalWeight;
    for (const name of units) {
      r -= rates[name] || 1;
      if (r <= 0) return name;
    }
    return units[units.length - 1];
  }

  function startDraft() {
    const game = GAMES[selectedGame];
    const numBots = parseInt(document.getElementById("num-bots").value);
    const numRounds = parseInt(document.getElementById("num-rounds").value);
    const draftType = document.getElementById("draft-type").value;
    playerIndex = parseInt(document.getElementById("player-position").value) - 1;

    // Read pick rates from inputs
    document.querySelectorAll("#pick-rate-grid input").forEach((inp) => {
      pickRates[inp.dataset.unit] = parseInt(inp.value) || 1;
    });

    // Build drafters list
    const total = numBots + 1;
    drafters = [];
    let botCount = 0;
    for (let i = 0; i < total; i++) {
      if (i === playerIndex) drafters.push("Player");
      else drafters.push("Bot " + (++botCount));
    }

    draftOrder = buildDraftOrder(total, numRounds, draftType, playerIndex);

    // Cap draft order if not enough units
    available = allUnits.filter((n) => !freeUnits.includes(n));
    if (draftOrder.length > available.length) {
      draftOrder = draftOrder.slice(0, available.length);
    }

    draftPicks = {};
    for (let i = 0; i < total; i++) draftPicks[i] = [];

    currentPick = 0;
    renderDraft();
    showScreen("draft");
    processNextPick();
  }

  function renderDraft() {
    const game = GAMES[selectedGame];
    const totalPicks = draftOrder.length;
    const numDrafters = drafters.length;

    // Info
    const round = Math.floor(currentPick / numDrafters) + 1;
    const pickInRound = (currentPick % numDrafters) + 1;
    document.getElementById("draft-info").innerHTML =
      currentPick < totalPicks
        ? `Round <strong>${round}</strong> &mdash; Pick <strong>${pickInRound}</strong> of ${numDrafters} &mdash; <strong>${drafters[draftOrder[currentPick]]}</strong>'s turn`
        : "<strong>Draft complete!</strong>";

    // Columns
    const colContainer = document.getElementById("draft-columns");
    colContainer.innerHTML = "";
    drafters.forEach((name, i) => {
      const col = document.createElement("div");
      col.className = "draft-column" + (i === playerIndex ? " player-col" : "");
      let html = `<h3>${name}</h3><ul>`;
      draftPicks[i].forEach((u) => (html += `<li>${u}</li>`));
      html += "</ul>";
      col.innerHTML = html;
      colContainer.appendChild(col);
    });

    // Free units bar
    document.getElementById("draft-free-units").innerHTML = freeUnits.length
      ? "Free: <span>" + freeUnits.join(", ") + "</span>"
      : "";

    // Available grid (only interactive on player turn)
    const gridContainer = document.getElementById("available-grid");
    gridContainer.innerHTML = "";
    if (currentPick < totalPicks && draftOrder[currentPick] === playerIndex) {
      available.forEach((name) => {
        const btn = document.createElement("button");
        btn.className = "unit-btn";
        btn.textContent = name;
        btn.addEventListener("click", () => playerPick(name));
        gridContainer.appendChild(btn);
      });
    } else if (currentPick < totalPicks) {
      const msg = document.createElement("div");
      msg.className = "waiting-msg";
      msg.textContent = drafters[draftOrder[currentPick]] + " is picking...";
      gridContainer.appendChild(msg);
    }
  }

  function playerPick(unitName) {
    makePick(playerIndex, unitName);
    processNextPick();
  }

  function makePick(drafterIndex, unitName) {
    draftPicks[drafterIndex].push(unitName);
    available = available.filter((n) => n !== unitName);
    currentPick++;
  }

  function processNextPick() {
    if (currentPick >= draftOrder.length || available.length === 0) {
      renderDraft();
      showResults();
      return;
    }

    const drafter = draftOrder[currentPick];
    if (drafter === playerIndex) {
      renderDraft();
      return; // wait for player click
    }

    // Bot pick with delay
    renderDraft();
    setTimeout(() => {
      const pick = weightedRandomPick(available, pickRates);
      makePick(drafter, pick);
      processNextPick();
    }, 400);
  }

  function showResults() {
    showScreen("results");
    const container = document.getElementById("results-columns");
    container.innerHTML = "";
    drafters.forEach((name, i) => {
      const col = document.createElement("div");
      col.className =
        "results-column" + (i === playerIndex ? " player-col" : "");
      let html = `<h3>${name}</h3><ul>`;
      draftPicks[i].forEach((u) => (html += `<li>${u}</li>`));
      html += "</ul>";
      col.innerHTML = html;
      container.appendChild(col);
    });

    // Free units in results
    document.getElementById("results-free-units").innerHTML = freeUnits.length
      ? "Free units: <span>" + freeUnits.join(", ") + "</span>"
      : "";

    document.getElementById("results-game-name").textContent =
      GAMES[selectedGame].name;
  }

  // --- Event Listeners ---
  document.getElementById("num-bots").addEventListener("change", updatePositionOptions);

  document.getElementById("free-unit-tags").addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") {
      const name = e.target.dataset.name;
      freeUnits = freeUnits.filter((n) => n !== name);
      renderFreeUnits();
      renderPickRates();
    }
  });

  document.getElementById("add-free-btn").addEventListener("click", () => {
    const sel = document.getElementById("add-free-select");
    if (sel.value) {
      freeUnits.push(sel.value);
      renderFreeUnits();
      renderPickRates();
    }
  });

  document.getElementById("advanced-toggle").addEventListener("click", function () {
    this.classList.toggle("open");
    document.getElementById("advanced-body").classList.toggle("open");
  });

  document.getElementById("start-draft-btn").addEventListener("click", startDraft);

  document.getElementById("btn-redraft").addEventListener("click", () => {
    renderSetup();
    showScreen("setup");
  });

  document.getElementById("btn-game-select").addEventListener("click", () => {
    showScreen("select");
  });

  document.getElementById("back-to-select").addEventListener("click", () => {
    showScreen("select");
  });

  document.getElementById("cancel-draft").addEventListener("click", () => {
    showScreen("select");
  });

  // --- Init ---
  renderGameList();
  showScreen("select");
})();
