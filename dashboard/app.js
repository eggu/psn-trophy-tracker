import { displayName, isSteam, isComplete, lastEarnedTime, sortGames } from './games.js';

let currentData = null;
const params = new URLSearchParams(location.search);
let currentFilter = ['completed', 'in_progress'].includes(params.get('state')) ? params.get('state') : 'all';
const gradeIcons = { platinum: '🏆', gold: '🥇', silver: '🥈', bronze: '🥉', achievement: '🎖️' };
const gradeNames = { platinum: '플래티넘', gold: '골드', silver: '실버', bronze: '브론즈', achievement: '도전과제' };
const number = value => value.toLocaleString('ko-KR');
const kst = value => value ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) + ' KST' : '정보 없음';
const description = trophy => trophy.localized?.['ko-KR']?.description ?? trophy.description;
const setText = (id, value) => { document.getElementById(id).textContent = value; };

function renderRoute() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const detail = path.match(/^\/game\/(NPWR\d+_\d+|steam-\d+)$/);
  document.querySelector('.profile-card').hidden = path !== '/';
  document.querySelector('.recent-card').hidden = path !== '/';
  document.querySelector('.games-card').hidden = path !== '/' && path !== '/games';
  document.getElementById('game-detail').hidden = !detail;
  document.getElementById('back-to-games').href = `/games${location.search}`;
  if (detail) renderGameDetail(detail[1]);
  else if (!['/', '/games'].includes(path)) {
    document.getElementById('game-detail').hidden = false;
    setText('detail-body', '페이지를 찾을 수 없습니다.');
  }
  if (!detail) document.title = path === '/games' ? '게임 목록 — Trophy & Achievement Tracker' : 'Trophy & Achievement Tracker';
}

async function loadData() {
  try {
    const response = await fetch('/data/current.json');
    if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('Snapshot unavailable');
    currentData = await response.json();
    renderOverview();
    renderRecent();
    renderGames();
    renderRoute();
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    setText('sync-status-text', '데이터 로딩 실패');
    setText('games-grid', '데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
  }
}

function renderOverview() {
  const { profile, steam, games } = currentData;
  const staleSources = [ ['PlayStation', profile.lastSuccessfulSync], ...(steam ? [['Steam', steam.lastSuccessfulSync]] : []) ]
    .filter(([, time]) => Date.now() - Date.parse(time) >= 12 * 3600_000).map(([source]) => source);
  document.getElementById('sync-badge').classList.toggle('fresh', !staleSources.length);
  setText('sync-status-text', staleSources.length ? `${staleSources.join(' · ')} 수집 데이터가 오래되었습니다` : '모든 플랫폼 최신 상태');
  setText('combined-earned', number(profile.trophies.total + (steam?.achievements.earned ?? 0)));
  setText('combined-games', number(games.length));
  setText('combined-completed', number(games.filter(isComplete).length));
  setText('combined-active', number(games.filter(game => game.progress.earned > 0 && !isComplete(game)).length));
  setText('online-id', profile.onlineId);
  setText('psn-level', `트로피 레벨 ${profile.trophyLevel}`);
  const avatar = document.getElementById('avatar-img');
  if (profile.avatarUrl) { avatar.src = profile.avatarUrl; avatar.hidden = false; }
  setText('psn-earned', number(profile.trophies.total));
  const psnGames = games.filter(game => !isSteam(game));
  setText('psn-games', `${number(psnGames.length)}개 게임 · 100% 완료 ${number(psnGames.filter(isComplete).length)}개`);
  document.getElementById('psn-grades').innerHTML = ['platinum', 'gold', 'silver', 'bronze'].map(grade => `<span>${gradeIcons[grade]} ${gradeNames[grade]} ${number(profile.trophies[grade])}</span>`).join('');
  setText('psn-sync', `수집 ${kst(profile.lastSuccessfulSync)}`);
  setText('steam-name', steam?.displayName ?? '아직 수집되지 않았습니다');
  setText('steam-earned', steam ? number(steam.achievements.earned) : '—');
  setText('steam-games', steam ? `${number(steam.games.total)}개 게임 · 100% 완료 ${number(steam.games.completed)}개` : '');
  setText('steam-available', steam ? `전체 도전과제 ${number(steam.achievements.total)}개` : '');
  setText('steam-sync', steam ? `수집 ${kst(steam.lastSuccessfulSync)}` : '');
}

function renderRecent() {
  const recent = currentData.games.flatMap(game => game.trophies.filter(t => t.earned && t.earnedAt).map(trophy => ({ game, trophy })))
    .sort((a, b) => Date.parse(b.trophy.earnedAt) - Date.parse(a.trophy.earnedAt)).slice(0, 5);
  document.getElementById('recent-trophies').innerHTML = recent.length ? recent.map(({ game, trophy }) => `
    <a class="recent-item" href="/game/${encodeURIComponent(game.id)}">
      <div class="recent-item-info"><span aria-hidden="true">${gradeIcons[trophy.grade]}</span><div>
        <div class="recent-item-title">${escapeHtml(displayName(trophy))}</div>
        <div class="recent-item-game">${escapeHtml(displayName(game))} · ${escapeHtml(game.platform.join(', '))}</div>
      </div></div><time class="recent-item-time" datetime="${escapeHtml(trophy.earnedAt)}">${kst(trophy.earnedAt)}</time>
    </a>`).join('') : '<p class="muted">획득 시각이 기록된 활동이 없습니다.</p>';
}

function renderGames() {
  const platform = document.getElementById('platform-filter').value;
  const sort = document.getElementById('game-sort').value;
  const games = sortGames(currentData.games.filter(game => (platform === 'all' || (platform === 'Steam') === isSteam(game)) &&
    (currentFilter === 'all' || (currentFilter === 'completed') === isComplete(game))), sort);
  setText('games-count', number(games.length));
  setText('sort-description', {
    played: '실제 마지막 플레이 시각 기준입니다. 정보가 없는 게임은 아래에 표시됩니다.',
    recent: '실제로 획득한 트로피·도전과제의 시각 기준입니다. 획득 시각이 없는 게임은 아래에 표시됩니다.',
    remaining: '수집을 시작한 미완료 게임 중 남은 개수가 적은 순입니다. 완료·미시작 게임은 아래에 표시됩니다.',
    progress: '플랫폼이 제공한 진행률이 높은 순입니다. PlayStation 진행률은 트로피 등급에 따라 가중될 수 있습니다.'
  }[sort] ?? '표시되는 게임 이름을 기준으로 정렬합니다.');
  if (sort === 'earned') setText('sort-description', '획득한 트로피·도전과제의 개수가 많은 순입니다.');
  document.getElementById('games-grid').innerHTML = games.length ? games.map(game => {
    const lastEarned = lastEarnedTime(game);
    return `<a class="game-card ${isSteam(game) ? 'steam-game' : 'psn-game'}" href="/game/${encodeURIComponent(game.id)}${escapeHtml(location.search)}">
      <div class="game-card-header">${game.imageUrl ? `<img class="game-thumbnail" src="${escapeHtml(game.imageUrl)}" alt="" loading="lazy" />` : '<span class="game-thumbnail thumbnail-placeholder" aria-hidden="true">🎮</span>'}
        <div class="game-meta"><h3 class="game-title">${escapeHtml(displayName(game))}</h3><div class="game-platforms">${platformBadges(game)}</div></div>
      </div><div class="game-card-body">
        <div class="progress-info"><span>${number(game.progress.earned)} / ${number(game.progress.total)} · ${game.progress.percentage}%</span><span>${isComplete(game) ? '✓ 100% 완료' : game.platinumEarned ? '🏆 플래티넘' : ''}</span></div>
        ${progressBar(game)}
        <p class="game-dates">마지막 플레이 ${game.lastPlayedAt ? kst(game.lastPlayedAt) : '정보 없음'}<br>최근 획득 ${kst(lastEarned)}</p>
      </div></a>`;
  }).join('') : '<p class="loading">해당하는 게임이 없습니다.</p>';
}

function platformBadges(game) {
  return game.platform.map(platform => `<span class="platform-badge">${escapeHtml(platform)}</span>`).join('');
}
function progressBar(game) {
  return `<div class="game-progress-bar" role="progressbar" aria-label="수집 진행률" aria-valuenow="${game.progress.percentage}" aria-valuemin="0" aria-valuemax="100"><div class="game-progress-fill ${isComplete(game) ? 'completed' : ''}" style="width:${game.progress.percentage}%"></div></div>`;
}

function renderGameDetail(id) {
  const game = currentData.games.find(game => game.id === id);
  if (!game) { setText('detail-body', '게임을 찾을 수 없습니다.'); return; }
  document.title = `${displayName(game)} — Trophy & Achievement Tracker`;
  const steam = isSteam(game);
  const noun = steam ? '도전과제' : '트로피';
  const lastEarned = lastEarnedTime(game);
  const syncTime = steam ? currentData.steam?.lastSuccessfulSync : currentData.profile.lastSuccessfulSync;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-header ${steam ? 'steam-game' : 'psn-game'}">${game.imageUrl ? `<img class="detail-cover" src="${escapeHtml(game.imageUrl)}" alt="" />` : ''}<div>
      <div class="game-platforms">${platformBadges(game)}</div><h2>${escapeHtml(displayName(game))}</h2>
      <p class="muted">${steam ? 'Steam 도전과제' : 'PlayStation 트로피'} · ${isComplete(game) ? '100% 완료' : game.platinumEarned ? '플래티넘 달성 · 추가 트로피 수집 중' : '수집 중'}</p>
    </div></div>
    <div class="detail-stats overview-stats"><div><strong>${number(game.progress.earned)}</strong><span>획득</span></div><div><strong>${number(game.progress.total - game.progress.earned)}</strong><span>남은 ${noun}</span></div><div><strong>${game.progress.percentage}%</strong><span>진행률</span></div></div>
    ${progressBar(game)}
    <div class="detail-dates"><p>마지막 플레이 <strong>${kst(game.lastPlayedAt)}</strong></p><p>최근 ${noun} 획득 <strong>${kst(lastEarned)}</strong></p><p>수집 <strong>${kst(syncTime)}</strong></p></div>
    ${steam ? '' : `<div class="grade-counts">${['platinum', 'gold', 'silver', 'bronze'].map(grade => `<span>${gradeIcons[grade]} ${gradeNames[grade]} ${game.trophySummary[grade].earned} / ${game.trophySummary[grade].total}</span>`).join('')}</div>`}
    <h3 class="detail-list-heading">${noun} 목록 <span class="muted">미획득 먼저 · ${game.trophies.length}개</span></h3>
    <div class="trophy-list-detail">${game.trophies.length ? game.trophies.slice().sort((a, b) => Number(a.earned) - Number(b.earned)).map(t => `
      <div class="trophy-detail-item ${t.earned ? 'earned' : 'unearned'}">
        ${t.iconUrl ? `<img class="achievement-icon" src="${escapeHtml(t.iconUrl)}" alt="" loading="lazy" />` : `<span aria-hidden="true">${gradeIcons[t.grade]}</span>`}
        <div class="trophy-detail-text"><h4>${escapeHtml(displayName(t))} ${t.hidden ? '<span class="hidden-label">숨겨진 항목</span>' : ''}</h4><p>${escapeHtml(description(t) || '설명 없음')}</p><p class="achievement-status">${t.earned ? `✓ 획득 · ${t.earnedAt ? kst(t.earnedAt) : '시각 미제공'}` : '미획득'}${steam ? '' : ` · ${gradeNames[t.grade]}`}</p></div>
      </div>`).join('') : `<p class="muted">${noun} 세부 목록이 없습니다.</p>`}</div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function updateSelection() {
  const query = new URLSearchParams();
  const platform = document.getElementById('platform-filter').value;
  const sort = document.getElementById('game-sort').value;
  if (platform !== 'all') query.set('platform', platform);
  if (sort !== 'recent') query.set('sort', sort);
  if (currentFilter !== 'all') query.set('state', currentFilter);
  history.replaceState(null, '', `${location.pathname}${query.size ? '?' + query : ''}`);
  document.querySelectorAll('.filter-btn').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (currentData) renderGames();
}

for (const [id, key] of [['platform-filter', 'platform'], ['game-sort', 'sort']]) {
  const select = document.getElementById(id);
  if ([...select.options].some(option => option.value === params.get(key))) select.value = params.get(key);
  select.addEventListener('change', updateSelection);
}
document.querySelectorAll('.filter-btn').forEach(button => button.addEventListener('click', () => { currentFilter = button.dataset.filter; updateSelection(); }));
updateSelection();
loadData();
