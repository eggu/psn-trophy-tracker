let currentData = null;
let currentFilter = "all";

async function loadData() {
  try {
    // 1. First attempt to load static canonical data (/data/current.json)
    let fullSnapshot = null;
    let dataRes = await fetch("./data/current.json").catch(() => null);
    if (!dataRes || !dataRes.ok) {
      dataRes = await fetch("/data/current.json").catch(() => null);
    }

    if (dataRes && dataRes.ok) {
      const contentType = dataRes.headers.get("content-type") || "";
      if (contentType.includes("json") || contentType.includes("application/octet-stream")) {
        fullSnapshot = await dataRes.json();
      }
    }

    // 2. If static file not found, try API endpoint
    if (!fullSnapshot) {
      const profileRes = await fetch("/api/v1/profile").catch(() => null);
      if (profileRes && profileRes.ok) {
        const ct = profileRes.headers.get("content-type") || "";
        if (ct.includes("json")) {
          const profile = await profileRes.json();
          const gamesRes = await fetch("/api/v1/games?limit=100");
          const gamesData = await gamesRes.json();
          const statusRes = await fetch("/api/v1/status");
          const statusData = await statusRes.json();
          fullSnapshot = {
            metadata: {
              lastSuccessfulSync: statusData.lastSuccessfulSync,
              generatedAt: statusData.lastSyncAttempt
            },
            profile,
            games: gamesData.games
          };
        }
      }
    }

    if (!fullSnapshot) {
      throw new Error("Could not load snapshot data from static file or API");
    }

    currentData = fullSnapshot;
    renderStatus(currentData.metadata);
    renderProfile(currentData.profile);
    renderRecent(currentData.games);
    renderGames(currentData.games);
  } catch (err) {
    console.error("Error loading dashboard data:", err);
    document.getElementById("sync-status-text").textContent = "데이터 로딩 실패";
  }
}

function renderStatus(metadata) {
  const badge = document.getElementById("sync-badge");
  const text = document.getElementById("sync-status-text");

  if (!metadata || !metadata.lastSuccessfulSync) {
    text.textContent = "동기화 정보 없음";
    return;
  }

  const syncDate = new Date(metadata.lastSuccessfulSync);
  const diffHours = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60);

  if (diffHours < 12) {
    badge.classList.add("fresh");
    text.textContent = `동기화 완료: ${syncDate.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  } else {
    badge.classList.remove("fresh");
    text.textContent = `오래된 데이터 (${Math.round(diffHours)}시간 전)`;
  }
}

function renderProfile(profile) {
  if (!profile) return;
  document.getElementById("online-id").textContent = profile.onlineId;
  document.getElementById("trophy-level").textContent = profile.trophyLevel;
  document.getElementById("level-bar").style.width = `${profile.progress}%`;
  document.getElementById("level-progress").textContent = `${profile.progress}%`;

  if (profile.avatarUrl) {
    document.getElementById("avatar-img").src = profile.avatarUrl;
  }

  document.getElementById("count-plat").textContent = profile.trophies.platinum;
  document.getElementById("count-gold").textContent = profile.trophies.gold;
  document.getElementById("count-silver").textContent = profile.trophies.silver;
  document.getElementById("count-bronze").textContent = profile.trophies.bronze;
  document.getElementById("count-total").textContent = profile.trophies.total;
}

function renderRecent(games) {
  const container = document.getElementById("recent-trophies");
  const allEarned = [];

  for (const game of games) {
    if (game.trophies) {
      for (const t of game.trophies) {
        if (t.earned && t.earnedAt) {
          allEarned.push({
            gameName: game.name,
            trophy: t
          });
        }
      }
    }
  }

  if (allEarned.length === 0) {
    container.innerHTML = `<div class="loading">최근 활동 내역이 없습니다.</div>`;
    return;
  }

  allEarned.sort((a, b) => new Date(b.trophy.earnedAt).getTime() - new Date(a.trophy.earnedAt).getTime());
  const recent = allEarned.slice(0, 5);

  const gradeIcons = { platinum: "🏆", gold: "🥇", silver: "🥈", bronze: "🥉" };

  container.innerHTML = recent.map((item) => `
    <div class="recent-item">
      <div class="recent-item-info">
        <span>${gradeIcons[item.trophy.grade] || "🏆"}</span>
        <div>
          <div class="recent-item-title">${escapeHtml(item.trophy.name)}</div>
          <div class="recent-item-game">${escapeHtml(item.gameName)}</div>
        </div>
      </div>
      <div class="recent-item-time">
        ${new Date(item.trophy.earnedAt).toLocaleDateString("ko-KR")}
      </div>
    </div>
  `).join("");
}

function renderGames(games) {
  const container = document.getElementById("games-grid");
  const countBadge = document.getElementById("games-count");

  let filtered = games;
  if (currentFilter === "completed") {
    filtered = games.filter((g) => g.platinumEarned || (g.progress.earned > 0 && g.progress.earned === g.progress.total));
  } else if (currentFilter === "in_progress") {
    filtered = games.filter((g) => !(g.platinumEarned || (g.progress.earned > 0 && g.progress.earned === g.progress.total)));
  }

  countBadge.textContent = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="loading">해당하는 게임이 없습니다.</div>`;
    return;
  }

  container.innerHTML = filtered.map((game) => `
    <div class="game-card" onclick="openGameDetail('${escapeHtml(game.id)}')">
      <div class="game-card-header">
        <img class="game-thumbnail" src="${game.imageUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%23202b3d%22/></svg>'}" alt="${escapeHtml(game.name)}" />
        <div class="game-meta">
          <div class="game-title">${escapeHtml(game.name)}</div>
          <div class="game-platforms">
            ${game.platform.map((p) => `<span class="platform-badge">${escapeHtml(p)}</span>`).join("")}
          </div>
        </div>
      </div>
      <div class="game-card-body">
        <div class="progress-info">
          <span>${game.progress.earned} / ${game.progress.total} (${game.progress.percentage}%)</span>
          <span>${game.platinumEarned ? '🏆 완료' : ''}</span>
        </div>
        <div class="game-progress-bar">
          <div class="game-progress-fill ${game.progress.percentage === 100 ? 'completed' : ''}" style="width: ${game.progress.percentage}%"></div>
        </div>
      </div>
    </div>
  `).join("");
}

window.openGameDetail = async function (gameId) {
  const game = currentData.games.find((g) => g.id === gameId);
  if (!game) return;

  const modal = document.getElementById("detail-modal");
  const modalBody = document.getElementById("modal-body");

  let trophies = game.trophies || [];
  if (trophies.length === 0) {
    // Attempt fetch from api
    try {
      const res = await fetch(`/api/v1/games/${encodeURIComponent(game.id)}/trophies`);
      if (res.ok) {
        const data = await res.json();
        trophies = data.trophies || [];
      }
    } catch (_) {}
  }

  const gradeIcons = { platinum: "🏆", gold: "🥇", silver: "🥈", bronze: "🥉" };

  modalBody.innerHTML = `
    <h2>${escapeHtml(game.name)}</h2>
    <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem;">
      진행률: ${game.progress.earned} / ${game.progress.total} (${game.progress.percentage}%)
    </p>
    <div class="trophy-list-detail">
      ${
        trophies.length > 0
          ? trophies.map((t) => `
            <div class="trophy-detail-item ${t.earned ? 'earned' : 'unearned'}">
              <span>${gradeIcons[t.grade] || "🏆"}</span>
              <div class="trophy-detail-text">
                <h4>${escapeHtml(t.name)} ${t.hidden ? '<span style="font-size:0.75rem; color:#f59e0b;">(Hidden)</span>' : ''}</h4>
                <p>${escapeHtml(t.description || "설명 없음")}</p>
                ${t.earned && t.earnedAt ? `<p style="font-size:0.75rem; color:var(--status-green);">획득: ${new Date(t.earnedAt).toLocaleString('ko-KR')}</p>` : ''}
              </div>
            </div>
          `).join("")
          : `<p class="loading">트로피 세부 목록이 없습니다.</p>`
      }
    </div>
  `;

  modal.classList.remove("hidden");
};

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  loadData();

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      if (currentData) renderGames(currentData.games);
    });
  });

  const modal = document.getElementById("detail-modal");
  document.getElementById("modal-close-btn").addEventListener("click", () => modal.classList.add("hidden"));
  document.getElementById("modal-close-overlay").addEventListener("click", () => modal.classList.add("hidden"));
});
