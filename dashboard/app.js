let currentData = null;
let currentFilter = "all";

function kst(value) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)) + ' KST';
}
function renderRoute() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const detail = path.match(/^\/game\/(NPWR\d+_\d+)$/);
  document.querySelector('.profile-card').hidden = path !== '/';
  document.querySelector('.recent-card').hidden = path !== '/';
  document.querySelector('.games-card').hidden = path !== '/' && path !== '/games';
  document.getElementById('game-detail').hidden = !detail;
  if (detail) openGameDetail(detail[1]);
  else if (!['/', '/games'].includes(path)) {
    document.getElementById('game-detail').hidden = false;
    document.getElementById('detail-body').textContent = '페이지를 찾을 수 없습니다.';
  }
  if (!detail) document.title = path === '/games' ? '게임 목록 — PSN Trophy Tracker' : 'PSN Trophy Tracker';
}
function displayName(item) { return item.localized?.["ko-KR"]?.name || item.name; }
function displayDescription(trophy) { return trophy.localized?.["ko-KR"]?.description ?? trophy.description; }

async function loadData() {
  try {
    const dataRes = await fetch('/data/current.json');
    if (!dataRes.ok || !(dataRes.headers.get('content-type') || '').includes('json')) throw new Error('Snapshot unavailable');
    const fullSnapshot = await dataRes.json();

    currentData = fullSnapshot;
    renderStatus(currentData.metadata);
    renderProfile(currentData.profile);
    renderRecent(currentData.games);
    renderGames(currentData.games);
    renderRoute();
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
    text.textContent = `동기화 완료: ${kst(metadata.lastSuccessfulSync)}`;
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
            gameName: displayName(game),
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
          <div class="recent-item-title">${escapeHtml(displayName(item.trophy))}</div>
          <div class="recent-item-game">${escapeHtml(item.gameName)}</div>
        </div>
      </div>
      <div class="recent-item-time">
        ${kst(item.trophy.earnedAt)}
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
    <a class="game-card" href="/game/${encodeURIComponent(game.id)}">
      <div class="game-card-header">
        <img class="game-thumbnail" src="${game.imageUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%23202b3d%22/></svg>'}" alt="${escapeHtml(displayName(game))}" />
        <div class="game-meta">
          <div class="game-title">${escapeHtml(displayName(game))}</div>
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
    </a>
  `).join("");
}

window.openGameDetail = async function (gameId) {
  const game = currentData.games.find((g) => g.id === gameId);
  if (!game) {
    document.getElementById('detail-body').textContent = '게임을 찾을 수 없습니다.';
    return;
  }
  document.title = `${displayName(game)} — PSN Trophy Tracker`;

  const detailBody = document.getElementById("detail-body");

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

  detailBody.innerHTML = `
    <h2>${escapeHtml(displayName(game))}</h2>
    <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem;">
      진행률: ${game.progress.earned} / ${game.progress.total} (${game.progress.percentage}%)
    </p>
    <div class="trophy-list-detail">
      ${
        trophies.length > 0
          ? trophies.slice().sort((a, b) => Number(a.earned) - Number(b.earned)).map((t) => `
            <div class="trophy-detail-item ${t.earned ? 'earned' : 'unearned'}">
              <span>${gradeIcons[t.grade] || "🏆"}</span>
              <div class="trophy-detail-text">
                <h4>${escapeHtml(displayName(t))} ${t.hidden ? '<span style="font-size:0.75rem; color:#f59e0b;">(Hidden)</span>' : ''}</h4>
                <p>${escapeHtml(displayDescription(t) || "설명 없음")}</p>
                ${t.earned && t.earnedAt ? `<p style="font-size:0.75rem; color:var(--status-green);">획득: ${kst(t.earnedAt)}</p>` : ''}
              </div>
            </div>
          `).join("")
          : `<p class="loading">트로피 세부 목록이 없습니다.</p>`
      }
    </div>
  `;
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
});
