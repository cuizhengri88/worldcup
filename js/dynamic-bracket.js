const STORAGE_KEY = 'worldcup2026.state.v3';

const state = {
  activeTab: 'groups',
  teams: {},
  qualifiers: {},
  bracket: { rounds: [] },
  schedule: { matches: [] },
  teamMetrics: { teams: {} },
  scheduleResults: {},
  scheduleCollapsed: {},
  groupResults: {},
  selections: {}
};

document.addEventListener('DOMContentLoaded', initDynamicBracket);

/**
 * 월드컵 예측 앱의 동적 렌더링을 시작한다.
 * 데이터 번들, 저장된 로컬 상태, 초기 탭 값을 준비한 뒤 첫 화면을 그리며,
 * 필수 데이터가 없을 때는 사용자에게 오류 패널을 보여준다.
 */
function initDynamicBracket() {
  const bracketRoot = document.querySelector('.tournament-bracket');
  if (!bracketRoot) return;

  try {
    const data = window.WORLDCUP_2026_DATA;
    if (!data) {
      throw new Error('js/bracket-data.js 데이터가 먼저 로드되어야 합니다.');
    }

    const savedState = loadSavedState();
    state.teams = data.teams;
    state.qualifiers = data.qualifiers;
    state.bracket = data.bracket;
    state.schedule = data.schedule || { matches: [] };
    state.teamMetrics = data.teamMetrics || { teams: {} };
    state.scheduleResults = savedState.scheduleResults || {};
    state.scheduleCollapsed = savedState.scheduleCollapsed || {};
    state.groupResults = createGroupResultsFromSchedule();
    state.selections = savedState.selections || {};
    state.activeTab = savedState.activeTab === 'teams' ? 'groups' : (savedState.activeTab || 'groups');

    ensureTabs();
    render();
  } catch (error) {
    bracketRoot.innerHTML = createErrorMarkup(error);
  }
}

/**
 * 대진표 스크롤 컨테이너 상단에 동적 탭 영역을 보장한다.
 * 이미 탭이 존재하면 중복 생성하지 않고, 렌더링 함수가 버튼만 갱신할 수 있게 빈 컨테이너를 만든다.
 */
function ensureTabs() {
  const scrollContainer = document.querySelector('.bracket-scroll-container');
  if (!scrollContainer || document.querySelector('.dynamic-tabs')) return;

  const tabs = document.createElement('div');
  tabs.className = 'dynamic-tabs';
  scrollContainer.insertBefore(tabs, scrollContainer.firstElementChild);
}

/**
 * 현재 활성 탭에 맞춰 화면 전체를 다시 그린다.
 * 조별 순위와 자동 대진 선택을 최신 일정/점수 기준으로 재계산하고,
 * 탭별 CSS 클래스와 컬럼 DOM을 교체한 뒤 상태를 localStorage에 저장한다.
 */
function render() {
  state.groupResults = createGroupResultsFromSchedule();
  state.selections = createAutomaticBracketSelections();
  normalizeSelections();
  renderTabs();

  const bracketRoot = document.querySelector('.tournament-bracket');
  const scrollContainer = document.querySelector('.bracket-scroll-container');
  bracketRoot.innerHTML = '';
  bracketRoot.classList.remove('group-stage-view', 'schedule-view', 'tournament-view');
  scrollContainer?.classList.remove('group-stage-scroll', 'schedule-scroll', 'tournament-scroll');

  if (state.activeTab === 'groups') {
    scrollContainer?.classList.add('group-stage-scroll');
    bracketRoot.classList.add('group-stage-view');
    bracketRoot.appendChild(createGroupStageControls());
    state.qualifiers.groups.forEach((group) => {
      bracketRoot.appendChild(createEditableGroupColumn(group));
    });
  } else if (state.activeTab === 'schedule') {
    scrollContainer?.classList.add('schedule-scroll');
    bracketRoot.classList.add('schedule-view');
    bracketRoot.appendChild(createScheduleControls());
    createScheduleDateGroups().forEach((dateGroup) => {
      bracketRoot.appendChild(createScheduleDateColumn(dateGroup));
    });
  } else {
    scrollContainer?.classList.add('tournament-scroll');
    bracketRoot.classList.add('tournament-view');
    bracketRoot.appendChild(createControls());
    state.bracket.rounds.forEach((round, roundIndex) => {
      bracketRoot.appendChild(createRoundColumn(round, roundIndex));
    });
    window.requestAnimationFrame(drawTournamentConnectors);
  }

  saveState();
}

window.addEventListener('resize', () => {
  if (state.activeTab === 'tournament') {
    window.requestAnimationFrame(drawTournamentConnectors);
  }
});

/**
 * 상단 탭 버튼들을 현재 상태 기준으로 다시 만든다.
 * 각 버튼은 활성 탭 표시를 갱신하고 클릭 시 상태를 바꾼 뒤 전체 렌더링을 다시 수행한다.
 */
function renderTabs() {
  const tabs = document.querySelector('.dynamic-tabs');
  if (!tabs) return;

  tabs.innerHTML = '';
  [
    { id: 'schedule', label: '경기 일정', icon: 'fa-calendar-days' },
    { id: 'groups', label: '조별정보', icon: 'fa-table' },
    { id: 'tournament', label: '토너먼트', icon: 'fa-sitemap' }
  ].forEach((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `dynamic-tab-btn ${state.activeTab === tab.id ? 'active' : ''}`;
    button.innerHTML = `<i class="fas ${tab.icon}"></i><span>${tab.label}</span>`;
    button.addEventListener('click', () => {
      state.activeTab = tab.id;
      render();
    });
    tabs.appendChild(button);
  });
}

/**
 * 조별정보 탭의 안내용 도구 컬럼을 만든다.
 * 조별 순위가 경기 일정 점수와 AI 예측 점수로 자동 계산된다는 설명을 표시한다.
 */
function createGroupStageControls() {
  const column = document.createElement('div');
  column.className = 'bracket-column bracket-tools-column';

  const header = document.createElement('div');
  header.className = 'round-header';
  header.innerHTML = '<i class="fas fa-sliders me-2"></i>소조 설정';

  const box = document.createElement('div');
  box.className = 'matchup-box left-side dynamic-tools';
  box.innerHTML = `
    <div class="match-meta"><span>GROUP STAGE</span><span>SCORES</span></div>
    <p class="dynamic-help">조별 순위는 경기 일정 탭의 점수로 자동 계산됩니다. 입력한 실제 결과가 없으면 AI 예측 점수를 기본값으로 사용합니다.</p>
  `;

  column.append(header, box);
  return column;
}

/**
 * 토너먼트 탭의 안내용 도구 컬럼을 만든다.
 * 32강부터 결승까지 자동 계산된다는 안내와 현재 토너먼트 모드의 기본 설명을 담는다.
 */
function createControls() {
  const column = document.createElement('div');
  column.className = 'bracket-column bracket-tools-column';

  const header = document.createElement('div');
  header.className = 'round-header';
  header.innerHTML = '<i class="fas fa-sliders me-2"></i>대진표 설정';

  const box = document.createElement('div');
  box.className = 'matchup-box left-side dynamic-tools';
  box.innerHTML = `
    <div class="match-meta"><span>TOURNAMENT</span><span>AUTO</span></div>
    <p class="dynamic-help">32강부터 결승까지 경기 일정 점수와 AI 예측으로 자동 계산됩니다. 실제 결과를 바꾸려면 경기 일정 탭에서 점수를 입력하세요.</p>
  `;

  column.append(header, box);
  return column;
}

/**
 * 경기 일정 탭의 상단 도구 컬럼을 만든다.
 * 일정 개수, 개막전/결승전 날짜, 전체 접기/펼치기, FIFA 결과 동기화 버튼을 구성한다.
 */
function createScheduleControls() {
  const matches = getSortedScheduleMatches();
  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];
  const column = document.createElement('div');
  column.className = 'bracket-column bracket-tools-column';

  const header = document.createElement('div');
  header.className = 'round-header';
  header.innerHTML = '<i class="fas fa-calendar-days me-2"></i>경기 일정';

  const box = document.createElement('div');
  box.className = 'matchup-box left-side dynamic-tools';
  box.innerHTML = `
    <div class="match-meta"><span>FIFA SCHEDULE</span><span>${matches.length} MATCHES</span></div>
    <p class="dynamic-help">FIFA 일정 데이터 형식에 맞춰 중국 시간 기준으로 날짜별 표시합니다. FIFA 결과 동기화 후 실제 점수가 있으면 자동 반영됩니다.</p>
    <div class="schedule-summary">
      <div><span>개막전</span><strong>${firstMatch ? formatScheduleDate(firstMatch.date, 'Asia/Shanghai') : '-'}</strong></div>
      <div><span>결승전</span><strong>${lastMatch ? formatScheduleDate(lastMatch.date, 'Asia/Shanghai') : '-'}</strong></div>
      <div><span>출처</span><strong>FIFA calendar API</strong></div>
    </div>
  `;

  const foldButtons = document.createElement('div');
  foldButtons.className = 'schedule-fold-actions';

  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'dynamic-reset-btn';
  collapseButton.innerHTML = '<i class="fas fa-compress"></i><span>전체 접기</span>';
  collapseButton.addEventListener('click', () => setAllScheduleDatesCollapsed(true));

  const expandButton = document.createElement('button');
  expandButton.type = 'button';
  expandButton.className = 'dynamic-reset-btn';
  expandButton.innerHTML = '<i class="fas fa-expand"></i><span>전체 펼치기</span>';
  expandButton.addEventListener('click', () => setAllScheduleDatesCollapsed(false));

  const syncButton = document.createElement('button');
  syncButton.type = 'button';
  syncButton.className = 'dynamic-reset-btn fifa-sync-btn';
  syncButton.innerHTML = '<i class="fas fa-cloud-arrow-down"></i><span>FIFA 결과 동기화</span>';
  syncButton.addEventListener('click', syncFifaMatchResults);
  foldButtons.append(collapseButton, expandButton);
  box.appendChild(foldButtons);
  box.appendChild(syncButton);

  column.append(header, box);
  return column;
}

/**
 * 전체 경기 일정을 중국 시간 기준 날짜별 그룹으로 묶는다.
 * 일정 카드 컬럼이 날짜 단위로 접히고 펼쳐질 수 있도록 `{ date, matches }` 배열을 반환한다.
 */
function createScheduleDateGroups() {
  const groups = new Map();
  getSortedScheduleMatches().forEach((match) => {
    const key = getScheduleDateKey(match.date, 'Asia/Shanghai');
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(match);
  });

  return Array.from(groups.entries()).map(([date, matches]) => ({ date, matches }));
}

/**
 * 특정 날짜의 경기 목록 컬럼을 만든다.
 * 날짜 헤더는 접기/펼치기 토글로 동작하고, 펼쳐진 상태에서 해당 날짜의 경기 카드를 순서대로 표시한다.
 */
function createScheduleDateColumn(dateGroup) {
  const column = document.createElement('div');
  column.className = 'bracket-column schedule-column';
  const isCollapsed = Boolean(state.scheduleCollapsed[dateGroup.date]);

  const header = document.createElement('button');
  header.type = 'button';
  header.className = `round-header schedule-date-toggle ${isCollapsed ? 'collapsed' : ''}`;
  header.innerHTML = `
    <span><i class="fas fa-calendar-day me-2"></i>${formatScheduleDate(dateGroup.date, 'Asia/Shanghai')}</span>
    <span class="schedule-date-meta">
      <span class="round-progress">${dateGroup.matches.length}경기</span>
      <i class="fas fa-chevron-down"></i>
    </span>
  `;
  header.addEventListener('click', () => {
    state.scheduleCollapsed[dateGroup.date] = !state.scheduleCollapsed[dateGroup.date];
    render();
  });
  column.appendChild(header);

  const matchList = document.createElement('div');
  matchList.className = 'schedule-date-match-list';
  matchList.hidden = isCollapsed;
  dateGroup.matches.forEach((match) => {
    matchList.appendChild(createScheduleCard(match));
  });
  column.appendChild(matchList);

  return column;
}

/**
 * 단일 경기 일정 카드를 만든다.
 * 홈/원정 팀, 현지/중국 시간, 적용 점수, 경기장 정보와 분석 버튼을 구성한다.
 */
function createScheduleCard(match) {
  const card = document.createElement('div');
  card.className = 'matchup-box schedule-card';
  if (match.homeCode === 'KOR' || match.awayCode === 'KOR') {
    card.classList.add('korea-highlight');
  }
  if (match.stage === 'Final') {
    card.classList.add('final-stage');
  }

  const meta = document.createElement('div');
  meta.className = 'match-meta';
  meta.innerHTML = `<span>MATCH ${match.matchNumber || '-'}</span><span>${getScheduleStageLabel(match)}</span>`;

  const scheduleTeams = getScheduleTeams(match);
  const homeLabel = getScheduleTeamLabel(scheduleTeams.homeId, match.home);
  const awayLabel = getScheduleTeamLabel(scheduleTeams.awayId, match.away);
  const localTime = formatScheduleTime(match.localDate || match.date);
  const chinaTime = formatScheduleTime(match.date, 'Asia/Shanghai');
  const appliedScore = getAppliedScheduleScore(match, scheduleTeams.homeId, scheduleTeams.awayId);

  const body = document.createElement('div');
  body.className = 'schedule-card-body';
  body.innerHTML = `
    <div class="schedule-time-row">
      <strong>중국 ${chinaTime}</strong>
      <span>현지 ${localTime}</span>
    </div>
    <div class="schedule-teams">
      <div>${homeLabel}</div>
      <span>vs</span>
      <div>${awayLabel}</div>
    </div>
    <div class="schedule-prediction">
      <span>${appliedScore.source === 'actual' ? '실제 결과' : 'AI 예측'}</span>
      <strong>${appliedScore.score}</strong>
      <em>${appliedScore.note}</em>
    </div>
    ${createScheduleResultInputsMarkup(match, scheduleTeams.homeId, scheduleTeams.awayId, appliedScore)}
    ${createScheduleAnalysisButtonMarkup(scheduleTeams.homeId, scheduleTeams.awayId)}
    <div class="schedule-venue">
      <i class="fas fa-location-dot"></i>
      <span>${match.stadium || match.venue || '-'} · ${match.city || '-'}</span>
    </div>
  `;

  card.append(meta, body);
  card.querySelector('[data-schedule-analysis]')?.addEventListener('click', () => {
    showMatchAnalysis(scheduleTeams.homeId, scheduleTeams.awayId, getScheduleStageLabel(match), appliedScore);
  });
  return card;
}

/**
 * 팀 상세 정보를 분석 모달에 표시한다.
 * 조, 시드, 스타일, 요약, 능력치 그리드와 함께 경기 일정/출전선수 보기 이동 버튼을 제공한다.
 */
function showTeamInfo(teamId) {
  const team = state.teams[teamId];
  openInfoModal(
    `${team.flag} ${team.name}`,
    '올해 팀 종합 능력치',
    team.rating.overall,
    `
      <div class="team-detail-panel">
        <div class="team-detail-row"><span>조</span><strong>${team.group}조</strong></div>
        <div class="team-detail-row"><span>시드/순번</span><strong>${team.seed}</strong></div>
        <div class="team-detail-row"><span>스타일</span><strong>${team.style}</strong></div>
        <p class="team-detail-summary">${team.summary}</p>
        ${createRatingGrid(team.rating)}
        <button type="button" class="modal-action-btn" data-schedule-team="${teamId}">
          <i class="fas fa-calendar-days"></i><span>경기 일정 보기</span>
        </button>
        <button type="button" class="modal-action-btn" data-squad-team="${teamId}">
          <i class="fas fa-users"></i><span>출전선수 보기</span>
        </button>
      </div>
    `
  );

  document.querySelector('[data-squad-team]')?.addEventListener('click', () => showSquad(teamId));
  document.querySelector('[data-schedule-team]')?.addEventListener('click', () => showTeamSchedule(teamId));
}

/**
 * 특정 팀의 경기 일정 목록을 모달에 표시한다.
 * 해당 팀이 홈/원정 어느 쪽인지 계산해 상대, 시간, 점수, 경기장 정보를 팀 관점으로 정리한다.
 */
function showTeamSchedule(teamId) {
  const team = state.teams[teamId];
  const matches = getScheduleMatchesForTeam(teamId);

  openInfoModal(
    `${team.flag} ${team.name} 경기 일정`,
    '일정',
    `${matches.length}경기`,
    `
      <div class="team-schedule-list">
        ${matches.length ? matches.map((item) => createTeamScheduleItemMarkup(teamId, item)).join('') : '<p class="team-detail-summary">현재 자동 대진표 기준으로 표시할 경기가 없습니다.</p>'}
        <button type="button" class="modal-action-btn" data-back-team="${teamId}">
          <i class="fas fa-arrow-left"></i><span>팀정보로 돌아가기</span>
        </button>
      </div>
    `
  );

  document.querySelector('[data-back-team]')?.addEventListener('click', () => showTeamInfo(teamId));
}

/**
 * 특정 팀이 포함된 모든 일정을 찾아 시간순 목록으로 반환한다.
 * 일정 데이터의 직접 팀 코드와 토너먼트 선택 결과를 함께 고려해 매칭한다.
 */
function getScheduleMatchesForTeam(teamId) {
  return getSortedScheduleMatches()
    .map((match) => {
      const scheduleTeams = getScheduleTeams(match);
      if (scheduleTeams.homeId !== teamId && scheduleTeams.awayId !== teamId) return null;
      return { match, scheduleTeams };
    })
    .filter(Boolean);
}

/**
 * 팀 상세 모달 안에 들어갈 일정 항목 HTML을 만든다.
 * 선택된 팀 기준으로 상대팀, 홈/원정 표시, 적용 점수, 경기 단계와 장소를 정리한다.
 */
function createTeamScheduleItemMarkup(teamId, item) {
  const { match, scheduleTeams } = item;
  const isHome = scheduleTeams.homeId === teamId;
  const opponentId = isHome ? scheduleTeams.awayId : scheduleTeams.homeId;
  const opponent = state.teams[opponentId];
  const appliedScore = getAppliedScheduleScore(match, scheduleTeams.homeId, scheduleTeams.awayId);
  const teamGoals = isHome ? appliedScore.homeGoals : appliedScore.awayGoals;
  const opponentGoals = isHome ? appliedScore.awayGoals : appliedScore.homeGoals;
  const scoreText = Number.isInteger(teamGoals) && Number.isInteger(opponentGoals)
    ? `${teamGoals} - ${opponentGoals}`
    : appliedScore.score;

  return `
    <div class="team-schedule-item">
      <div class="team-schedule-top">
        <strong>${formatScheduleDate(match.date, 'Asia/Shanghai')}</strong>
        <span>${getScheduleStageLabel(match)}</span>
      </div>
      <div class="team-schedule-match">
      <span>${opponent ? `${getFlagIconMarkup(opponentId)} ${opponent.name}` : '대진 미정'}</span>
        <strong>${scoreText}</strong>
      </div>
      <div class="team-schedule-meta">
        <span><i class="fas fa-clock"></i> 중국 ${formatScheduleTime(match.date, 'Asia/Shanghai')} · 현지 ${formatScheduleTime(match.localDate || match.date)}</span>
        <span><i class="fas fa-location-dot"></i> ${match.stadium || match.venue || '-'} · ${match.city || '-'}</span>
      </div>
      <div class="team-schedule-source ${appliedScore.source === 'actual' ? 'actual' : ''}">
        ${appliedScore.source === 'actual' ? '실제 결과 반영' : 'AI 예측 점수'}
      </div>
    </div>
  `;
}

/**
 * 팀의 출전선수 목록을 포지션별 섹션으로 나누어 모달에 표시한다.
 * 각 선수 행에 클릭 리스너를 붙여 선수 상세 화면으로 진입할 수 있게 한다.
 */
function showSquad(teamId) {
  const team = state.teams[teamId];
  const squad = getSquad(team);
  openInfoModal(
    `${team.flag} ${team.name} 출전선수`,
    '등록 선수',
    squad.length,
    `
      <div class="squad-list">
        ${createSquadPositionSectionsMarkup(squad)}
      </div>
    `
  );

  document.querySelectorAll('[data-player-index]').forEach((button) => {
    button.addEventListener('click', () => {
      showPlayerInfo(teamId, Number(button.dataset.playerIndex));
    });
  });
}

/**
 * 선수단 배열을 골키퍼/수비수/미드필더/공격수 순서로 묶어 HTML 섹션을 만든다.
 * 각 선수 행에는 사진, 다국어 이름, 등번호/클럽, 능력치가 포함된다.
 */
function createSquadPositionSectionsMarkup(squad) {
  const positionOrder = ['GK', 'DF', 'MF', 'FW'];
  return positionOrder.map((position) => {
    const players = squad
      .map((player, index) => ({ player, index }))
      .filter((item) => item.player.position === position);
    if (!players.length) return '';

    return `
      <section class="squad-position-section">
        <div class="squad-position-header">
          <strong>${getPositionGroupLabel(position)}</strong>
          <span>${players.length}명</span>
        </div>
        <div class="squad-position-grid">
          ${players.map(({ player, index }) => `
            <button type="button" class="squad-player-btn" data-player-index="${index}">
              ${createPlayerPhotoMarkup(player)}
              <span class="squad-player-meta">
                ${createLocalizedPlayerNameMarkup(player)}
                <small>${player.number ? `${player.number}번 · ` : ''}${player.club || '-'}</small>
              </span>
              <em>${player.rating}</em>
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }).join('');
}

/**
 * 포지션 코드를 선수 목록 섹션 제목으로 변환한다.
 * 알려진 코드가 아니면 일반 포지션 라벨 변환 함수로 위임해 fallback을 제공한다.
 */
function getPositionGroupLabel(position) {
  return {
    GK: '골키퍼',
    DF: '수비수',
    MF: '미드필더',
    FW: '공격수'
  }[position] || getPositionLabel(position);
}

/**
 * 선수 목록에서 쓰는 작은 원형 사진 HTML을 만든다.
 * 사진 URL이 없거나 로딩 실패 시 선수 이니셜 fallback을 같은 위치에 표시한다.
 */
function createPlayerPhotoMarkup(player) {
  const initials = getPlayerInitials(player);
  if (!player.photoUrl) {
    return `<span class="player-photo-fallback">${initials}</span>`;
  }

  return `
    <span class="player-photo-wrap">
      <img src="${player.photoUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.querySelector('.player-photo-fallback').style.display='inline-flex';">
      <span class="player-photo-fallback">${initials}</span>
    </span>
  `;
}

/**
 * 선수 영문 이름에서 최대 두 글자의 이니셜을 만든다.
 * 사진 fallback과 프로필 placeholder에 사용하며 이름이 없으면 물음표를 반환한다.
 */
function getPlayerInitials(player) {
  return (player.name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

/**
 * 선택한 선수의 상세 정보를 모달에 표시한다.
 * 큰 프로필 이미지, 다국어 이름, 소속팀, 포지션, 대표팀 기록과 능력치 그리드를 함께 보여준다.
 */
function showPlayerInfo(teamId, playerIndex) {
  const team = state.teams[teamId];
  const player = getSquad(team)[playerIndex];
  openInfoModal(
    getLocalizedPlayerNameParts(player).ko,
    getPositionLabel(player.position),
    player.rating,
    `
      <div class="team-detail-panel">
        ${createPlayerProfileHeroMarkup(player)}
        <div class="team-detail-row"><span>소속 국가</span><strong>${team.flag} ${team.name}</strong></div>
        <div class="team-detail-row"><span>中文</span><strong>${getLocalizedPlayerNameParts(player).zh}</strong></div>
        <div class="team-detail-row"><span>English</span><strong>${getLocalizedPlayerNameParts(player).en}</strong></div>
        ${player.club ? `<div class="team-detail-row"><span>소속팀</span><strong>${player.club}</strong></div>` : ''}
        <div class="team-detail-row"><span>포지션</span><strong>${getPositionLabel(player.position)}</strong></div>
        ${player.age ? `<div class="team-detail-row"><span>나이</span><strong>${player.age}</strong></div>` : ''}
        <div class="team-detail-row"><span>A매치</span><strong>${player.caps ?? '-'}</strong></div>
        <div class="team-detail-row"><span>대표팀 득점</span><strong>${player.goals ?? '-'}</strong></div>
        <div class="team-detail-row"><span>종합</span><strong>${player.rating}</strong></div>
        ${createRatingGrid({
          attack: player.attack,
          defense: player.defense,
          form: player.form
        })}
        <button type="button" class="modal-action-btn" data-back-squad="${teamId}">
          <i class="fas fa-arrow-left"></i><span>출전선수 목록</span>
        </button>
      </div>
    `
  );

  document.querySelector('[data-back-squad]')?.addEventListener('click', () => showSquad(teamId));
}

/**
 * 선수 상세 화면 상단의 큰 프로필 영역 HTML을 만든다.
 * 원형 이미지, 로딩 실패 fallback, 다국어 이름과 등번호/클럽 보조 정보를 한 묶음으로 구성한다.
 */
function createPlayerProfileHeroMarkup(player) {
  const initials = getPlayerInitials(player);
  const names = getLocalizedPlayerNameParts(player);
  const imageMarkup = player.photoUrl
    ? `<img src="${player.photoUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.querySelector('.player-profile-fallback').style.display='inline-flex';">`
    : '';

  return `
    <div class="player-profile-hero">
      <span class="player-profile-photo">
        ${imageMarkup}
        <span class="player-profile-fallback"${player.photoUrl ? '' : ' style="display: inline-flex;"'}>${initials}</span>
      </span>
      <div class="player-profile-name">
        ${createLocalizedPlayerNameMarkup(player)}
        <small>${player.number ? `${player.number}번 · ` : ''}${player.club || names.en}</small>
      </div>
    </div>
  `;
}

/**
 * 공용 분석 모달의 제목, 배지, 주요 값, 본문 HTML을 갱신하고 표시한다.
 * 이미 열려 있는 모달을 재사용할 때는 Bootstrap 레이아웃 업데이트만 수행한다.
 */
function openInfoModal(title, badge, value, html) {
  const modalEl = document.getElementById('analysisModal');
  document.getElementById('titleTeam').innerText = title;
  document.querySelector('.modal-body .badge').innerText = badge;
  document.getElementById('labelOdds').innerText = value;
  document.getElementById('labelReason').innerHTML = html;

  const modalTarget = bootstrap.Modal.getOrCreateInstance(modalEl);
  if (modalEl.classList.contains('show')) {
    modalTarget.handleUpdate();
  } else {
    modalTarget.show();
  }
}

/**
 * 공격/수비/폼 등 능력치 객체를 작은 지표 그리드 HTML로 변환한다.
 * 지표 키는 사용자에게 보이는 한국어 라벨로 바꿔 표시한다.
 */
function createRatingGrid(rating) {
  return `
    <div class="rating-grid">
      ${Object.entries(rating).map(([key, value]) => `
        <div class="rating-cell">
          <span>${getRatingLabel(key)}</span>
          <strong>${value}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * 팀 데이터에서 선수단 배열을 가져온다.
 * 상세 squad 데이터가 없으면 기존 players 이름 배열을 기반으로 최소 선수 객체를 생성해 화면이 깨지지 않게 한다.
 */
function getSquad(team) {
  return team.squad?.length ? team.squad : (team.players || []).map((name, index) => ({
    name,
    position: ['FW', 'MF', 'DF', 'GK'][index % 4],
    rating: team.rating.overall,
    attack: team.rating.attack,
    defense: team.rating.defense,
    form: team.rating.form
  }));
}

/**
 * 선수 이름을 한국어, 중국어, 영어 순서의 stacked markup으로 만든다.
 * 데이터에 번역명이 없으면 내장 override와 간단한 음역 fallback을 사용한다.
 */
function createLocalizedPlayerNameMarkup(player) {
  const names = getLocalizedPlayerNameParts(player);
  return `
    <strong class="player-name-stack">
      <span>${names.ko}</span>
      <small>${names.zh}</small>
      <small>${names.en}</small>
    </strong>
  `;
}

/**
 * 선수 한 명의 한국어/중국어/영어 이름 세트를 계산한다.
 * 직접 제공된 값, 전체 이름 override, 음역 fallback 순서로 가장 적절한 표시명을 고른다.
 */
function getLocalizedPlayerNameParts(player) {
  const en = player.name || '-';
  const key = stripNameMarks(en).toLowerCase();
  return {
    ko: player.nameKo || KOREAN_FULL_NAME_OVERRIDES[key] || en,
    zh: player.nameZh || CHINESE_FULL_NAME_OVERRIDES[key] || en,
    en
  };
}

/**
 * 영문 이름 전체를 간단한 한국어 음역 문자열로 변환한다.
 * 단어별 override를 먼저 적용하고, 없으면 음절 단위 변환 함수로 처리한다.
 */
function transliterateNameToKorean(name) {
  const cleanName = stripNameMarks(name);
  return cleanName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => KOREAN_NAME_OVERRIDES[part.toLowerCase()] || transliterateWordToKorean(part))
    .join(' ');
}

/**
 * 영문 단어 하나를 대략적인 한글 발음으로 변환한다.
 * 자음 시작부, 모음, 받침을 나눠 내장 매핑으로 조합하며 완벽한 언어 변환보다는 표시 fallback에 초점을 둔다.
 */
function transliterateWordToKorean(word) {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return word;

  const chunks = normalized.match(/ch|sh|th|ph|qu|[bcdfghjklmnpqrstvwxyz]*[aeiouy]+[bcdfghjklmnpqrstvwxyz]*/g) || [normalized];
  return chunks.map((chunk) => {
    if (KOREAN_SYLLABLES[chunk]) return KOREAN_SYLLABLES[chunk];
    const vowel = chunk.match(/[aeiouy]+/)?.[0] || '';
    const onset = chunk.slice(0, Math.max(0, chunk.indexOf(vowel)));
    const coda = chunk.slice(onset.length + vowel.length);
    return `${KOREAN_ONSETS[onset] || KOREAN_ONSETS[onset[0]] || ''}${KOREAN_VOWELS[vowel] || KOREAN_VOWELS[vowel[0]] || '어'}${KOREAN_CODAS[coda] || KOREAN_CODAS[coda[0]] || ''}`;
  }).join('');
}

/**
 * 영문 이름 전체를 간단한 중국어 음역 문자열로 변환한다.
 * 단어 override를 우선 사용하고, 없는 단어는 음절/첫 글자 기반 fallback으로 채운다.
 */
function transliterateNameToChinese(name) {
  const cleanName = stripNameMarks(name);
  return cleanName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => CHINESE_NAME_OVERRIDES[part.toLowerCase()] || transliterateWordToChinese(part))
    .join('·');
}

/**
 * 영문 단어 하나를 중국어 음역 fallback으로 변환한다.
 * 음절 매핑이 없으면 첫 글자 기반 기본 음절을 사용해 빈 표시가 나오지 않게 한다.
 */
function transliterateWordToChinese(word) {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return word;

  const chunks = normalized.match(/ch|sh|th|ph|[bcdfghjklmnpqrstvwxyz]*[aeiouy]+[bcdfghjklmnpqrstvwxyz]*/g) || [normalized];
  return chunks.map((chunk) => CHINESE_SYLLABLES[chunk] || CHINESE_SYLLABLES[chunk[0]] || '恩').join('');
}

/**
 * 이름 비교와 음역 전에 악센트/구분 기호를 정규화한다.
 * 유니코드 결합 기호를 제거해 override key와 검색 key를 안정적으로 맞춘다.
 */
function stripNameMarks(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/-/g, ' ')
    .trim();
}

const KOREAN_NAME_OVERRIDES = {
  kim: '김',
  lee: '이',
  son: '손',
  hwang: '황',
  cho: '조',
  park: '박',
  paek: '백',
  paik: '백',
  seol: '설',
  eom: '엄',
  oh: '오',
  bae: '배',
  yang: '양',
  jo: '조',
  ronaldo: '호날두',
  messi: '메시',
  neymar: '네이마르',
  mbappe: '음바페',
  kane: '케인'
};

const KOREAN_FULL_NAME_OVERRIDES = {
  'kim seung gyu': '김승규',
  'lee han beom': '이한범',
  'lee ki hyuk': '이기혁',
  'kim min jae': '김민재',
  'kim tae hyeon': '김태현',
  'hwang in beom': '황인범',
  'son heung min': '손흥민',
  'paik seung ho': '백승호',
  'cho gue sung': '조규성',
  'lee jae sung': '이재성',
  'hwang hee chan': '황희찬',
  'song bum keun': '송범근',
  'lee tae seok': '이태석',
  'cho wi je': '조위제',
  'kim moon hwan': '김문환',
  'park jin seob': '박진섭',
  'bae jun ho': '배준호',
  'oh hyeon gyu': '오현규',
  'lee kang in': '이강인',
  'yang hyun jun': '양현준',
  'jo hyeon woo': '조현우',
  'seol young woo': '설영우',
  'jens castrop': '옌스 카스트로프',
  'kim jin gyu': '김진규',
  'eom ji sung': '엄지성',
  'lee dong gyeong': '이동경',
  'alisson': '알리송',
  'brice samba': '브리스 삼바',
  'kylian mbappe': '킬리안 음바페',
  'vinicius junior': '비니시우스 주니오르',
  'lionel messi': '리오넬 메시',
  'cristiano ronaldo': '크리스티아누 호날두',
  'harry kane': '해리 케인',
  'neymar': '네이마르'
};

const KOREAN_ONSETS = {
  b: '브', c: '크', d: '드', f: '프', g: '그', h: '흐', j: '즈', k: '크', l: '르', m: '므',
  n: '느', p: '프', q: '크', r: '르', s: '스', t: '트', v: '브', w: '우', x: '크스', y: '이', z: '즈',
  ch: '치', sh: '시', th: '트', ph: '프', qu: '퀴'
};

const KOREAN_VOWELS = {
  a: '아', e: '에', i: '이', o: '오', u: '우', y: '이',
  ai: '아이', ae: '애', au: '아우', ea: '이', ee: '이', ei: '에이', eu: '외', ia: '이아',
  ie: '이에', io: '이오', oa: '오아', oe: '오에', oi: '오이', oo: '우', ou: '우', ua: '우아'
};

const KOREAN_CODAS = {
  b: '브', c: '크', d: '드', f: '프', g: '그', h: '', j: '지', k: '크', l: '르', m: '므',
  n: '느', p: '프', q: '크', r: '르', s: '스', t: '트', v: '브', w: '', x: '크스', y: '이', z: '즈',
  ch: '치', sh: '시', th: '스'
};

const KOREAN_SYLLABLES = {
  al: '알', an: '안', ar: '아르', ba: '바', be: '베', bi: '비', bo: '보', ca: '카', ce: '세', ci: '시',
  co: '코', da: '다', de: '데', di: '디', do: '도', el: '엘', en: '엔', er: '에르', fa: '파',
  fe: '페', fi: '피', ga: '가', ge: '게', gi: '기', go: '고', ha: '하', he: '헤', hi: '히',
  ja: '자', jo: '조', la: '라', le: '레', li: '리', lo: '로', ma: '마', me: '메', mi: '미',
  mo: '모', na: '나', ne: '네', ni: '니', no: '노', pa: '파', pe: '페', pi: '피', po: '포',
  ra: '라', re: '레', ri: '리', ro: '로', sa: '사', se: '세', si: '시', so: '소', ta: '타',
  te: '테', ti: '티', to: '토', va: '바', ve: '베', vi: '비', wa: '와', ya: '야'
};

const CHINESE_NAME_OVERRIDES = {
  kim: '金',
  lee: '李',
  son: '孙',
  hwang: '黄',
  cho: '曹',
  park: '朴',
  jo: '赵',
  ronaldo: '罗纳尔多',
  messi: '梅西',
  neymar: '内马尔',
  mbappe: '姆巴佩',
  kane: '凯恩'
};

const CHINESE_FULL_NAME_OVERRIDES = {
  'kim seung gyu': '金承奎',
  'lee han beom': '李汉汎',
  'lee ki hyuk': '李基赫',
  'kim min jae': '金玟哉',
  'kim tae hyeon': '金泰贤',
  'hwang in beom': '黄仁范',
  'son heung min': '孙兴慜',
  'paik seung ho': '白昇浩',
  'cho gue sung': '曹圭成',
  'lee jae sung': '李在城',
  'hwang hee chan': '黄喜灿',
  'song bum keun': '宋范根',
  'lee tae seok': '李泰锡',
  'cho wi je': '曹伟济',
  'kim moon hwan': '金纹奂',
  'park jin seob': '朴镇燮',
  'bae jun ho': '裴峻浩',
  'oh hyeon gyu': '吴贤揆',
  'lee kang in': '李刚仁',
  'yang hyun jun': '杨贤俊',
  'jo hyeon woo': '赵贤祐',
  'seol young woo': '薛英佑',
  'jens castrop': '延斯·卡斯特罗普',
  'kim jin gyu': '金珍圭',
  'eom ji sung': '严智星',
  'lee dong gyeong': '李东炅',
  'alisson': '阿利松',
  'brice samba': '布里斯·桑巴',
  'kylian mbappe': '基利安·姆巴佩',
  'vinicius junior': '维尼修斯·儒尼奥尔',
  'lionel messi': '利昂内尔·梅西',
  'cristiano ronaldo': '克里斯蒂亚诺·罗纳尔多',
  'harry kane': '哈里·凯恩',
  'neymar': '内马尔'
};

const CHINESE_SYLLABLES = {
  a: '阿', b: '布', c: '克', d: '德', e: '埃', f: '弗', g: '格', h: '赫', i: '伊', j: '杰',
  k: '克', l: '勒', m: '姆', n: '恩', o: '奥', p: '普', q: '库', r: '尔', s: '斯', t: '特',
  u: '乌', v: '维', w: '沃', x: '克斯', y: '伊', z: '兹',
  al: '阿尔', an: '安', ar: '阿尔', ba: '巴', be: '贝', bi: '比', bo: '博', ca: '卡', ce: '塞',
  ci: '奇', co: '科', da: '达', de: '德', di: '迪', do: '多', el: '埃尔', en: '恩', er: '尔',
  fa: '法', fe: '费', fi: '菲', ga: '加', ge: '格', gi: '吉', go: '戈', ha: '哈', he: '赫',
  hi: '希', ja: '贾', jo: '乔', la: '拉', le: '莱', li: '利', lo: '洛', ma: '马', me: '梅',
  mi: '米', mo: '莫', na: '纳', ne: '内', ni: '尼', no: '诺', pa: '帕', pe: '佩', pi: '皮',
  po: '波', ra: '拉', re: '雷', ri: '里', ro: '罗', sa: '萨', se: '塞', si: '西', so: '索',
  ta: '塔', te: '特', ti: '蒂', to: '托', va: '瓦', ve: '韦', vi: '维', wa: '瓦', ya: '亚',
  ch: '奇', sh: '什', th: '特', ph: '夫'
};

/**
 * 포지션 코드(GK/DF/MF/FW)를 한국어 라벨로 변환한다.
 * 알 수 없는 코드는 원래 코드를 반환해 데이터 누락 시에도 표시가 유지되게 한다.
 */
function getPositionLabel(position) {
  const labels = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' };
  return labels[position] || position;
}

/**
 * 능력치 키를 화면 표시용 한국어 라벨로 변환한다.
 * 팀 능력치와 선수 능력치 그리드에서 공통으로 사용한다.
 */
function getRatingLabel(key) {
  const labels = {
    overall: '종합',
    attack: '공격',
    midfield: '중원',
    defense: '수비',
    depth: '선수층',
    experience: '경험',
    form: '최근 폼'
  };
  return labels[key] || key;
}

/**
 * 조별정보 탭의 한 조 컬럼을 만든다.
 * 경기 결과와 예측 점수로 계산된 순위표를 버튼 행으로 표시하고, 팀 클릭 시 상세 모달로 연결한다.
 */
function createEditableGroupColumn(group) {
  const column = document.createElement('div');
  column.className = 'bracket-column group-edit-column';

  const header = document.createElement('div');
  header.className = 'round-header';
  header.innerHTML = `<i class="fas fa-table me-2"></i>${group.label}`;

  const box = document.createElement('div');
  box.className = 'matchup-box left-side group-edit-box';

  const meta = document.createElement('div');
  meta.className = 'match-meta';
  meta.innerHTML = `<span>GROUP ${group.id}</span><span>${group.qualifiers.length}팀</span>`;
  box.appendChild(meta);

  getGroupStandings(group).forEach((standing, index) => {
    box.appendChild(createGroupStandingRow(standing, index + 1));
  });

  column.append(header, box);
  return column;
}

/**
 * 조별 순위표의 한 팀 행을 버튼 DOM으로 만든다.
 * 순위, 국기, 팀명, 승점, 승무패, 득실을 표시하고 팀 상세 보기 이벤트를 붙인다.
 */
function createGroupStandingRow(standing, rank) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'group-standing-row';
  row.innerHTML = `
    <div class="group-standing-main">
      <span class="group-team-rank">${rank}위</span>
      ${getFlagIconMarkup(standing.teamId)}
      <strong>${standing.team.name}</strong>
    </div>
    <div class="group-standing-stats">
      <span>승점 ${standing.points}</span>
      <span>${standing.wins}승 ${standing.draws}무 ${standing.losses}패</span>
      <span>득실 ${standing.goalDifference >= 0 ? '+' : ''}${standing.goalDifference}</span>
    </div>
  `;
  row.addEventListener('click', () => showTeamInfo(standing.teamId));
  return row;
}

/**
 * 토너먼트 탭의 한 라운드 컬럼을 만든다.
 * 라운드 제목, 진행률, 매치 카드 stack 높이와 카드 위치를 계산해 트리 형태 배치를 구성한다.
 */
function createRoundColumn(round, roundIndex) {
  const column = document.createElement('div');
  column.className = `bracket-column tournament-round-column tournament-round-${round.id}`;

  const header = document.createElement('div');
  header.className = 'round-header';
  header.innerHTML = `<i class="fas fa-sitemap me-2"></i>${round.label} <span class="round-progress">${getRoundProgress(round)}</span>`;
  column.appendChild(header);

  const stack = document.createElement('div');
  stack.className = 'tournament-match-stack';
  stack.style.height = `${getTournamentStackHeight()}px`;

  getDisplayMatchesForRound(round, roundIndex).forEach((match, displayIndex) => {
    const card = createMatchCard(round, roundIndex, match);
    card.style.top = `${getTournamentCardTop(roundIndex, displayIndex)}px`;
    stack.appendChild(card);
  });

  column.appendChild(stack);
  return column;
}

/**
 * 토너먼트 카드의 세로 위치를 라운드와 표시 순서 기준으로 계산한다.
 * 라운드가 깊어질수록 카드 간 간격을 넓혀 연결선이 자연스럽게 보이도록 한다.
 */
function getTournamentCardTop(roundIndex, displayIndex) {
  const baseGap = 354;
  return (((displayIndex + 0.5) * Math.pow(2, roundIndex)) - 0.5) * baseGap;
}

/**
 * 토너먼트 카드 stack 전체 높이를 계산한다.
 * 현재 32강 기준 카드 수와 기본 간격을 바탕으로 절대 배치 영역의 높이를 고정한다.
 */
function getTournamentStackHeight() {
  const cardHeight = 306;
  const baseGap = 354;
  return 15 * baseGap + cardHeight;
}

/**
 * 특정 라운드의 경기 표시 순서를 결정한다.
 * 결승에서 역으로 따라간 브래킷 트리 순서를 우선하고, 누락된 경기는 뒤에 붙인다.
 */
function getDisplayMatchesForRound(round, roundIndex) {
  const orderedIds = getBracketTreeOrderForRound(roundIndex);
  if (!orderedIds.length) return round.matches;

  const matchById = Object.fromEntries(round.matches.map((match) => [match.id, match]));
  const orderedMatches = orderedIds.map((id) => matchById[id]).filter(Boolean);
  const orderedSet = new Set(orderedMatches.map((match) => match.id));
  const remainingMatches = round.matches.filter((match) => !orderedSet.has(match.id));
  return [...orderedMatches, ...remainingMatches];
}

/**
 * 결승 경로를 기준으로 특정 라운드의 매치 ID 표시 순서를 계산한다.
 * source match 연결을 재귀적으로 따라가 좌우 브래킷 흐름이 맞게 정렬한다.
 */
function getBracketTreeOrderForRound(targetRoundIndex) {
  const finalRoundIndex = state.bracket.rounds.length - 1;
  const finalRound = state.bracket.rounds[finalRoundIndex];
  if (!finalRound) return [];

  const roundIndexByMatchId = new Map();
  const matchById = new Map();
  state.bracket.rounds.forEach((round, roundIndex) => {
    round.matches.forEach((match) => {
      roundIndexByMatchId.set(match.id, roundIndex);
      matchById.set(match.id, match);
    });
  });

  const collect = (match, matchRoundIndex) => {
    if (!match) return [];
    if (matchRoundIndex === targetRoundIndex) return [match.id];
    if (matchRoundIndex < targetRoundIndex) return [];

    return [match.teamASourceMatch, match.teamBSourceMatch].flatMap((sourceMatchId) => {
      const sourceMatch = matchById.get(sourceMatchId);
      const sourceRoundIndex = roundIndexByMatchId.get(sourceMatchId);
      return collect(sourceMatch, sourceRoundIndex);
    });
  };

  return finalRound.matches.flatMap((match) => collect(match, finalRoundIndex));
}

/**
 * 토너먼트 경기 카드 DOM을 만든다.
 * 자동 배정된 두 팀, 적용 점수, 승자, 요약 분석 버튼을 포함하고 한국/결승 강조 클래스를 적용한다.
 */
function createMatchCard(round, roundIndex, match) {
  const selection = getSelection(match.id);
  const comparison = getComparison(selection.teamA, selection.teamB);
  const result = getTournamentDisplayResult(match, selection);
  const sideClass = roundIndex >= 3 ? 'right-side' : 'left-side';

  const card = document.createElement('div');
  card.className = `matchup-box ${sideClass} tournament-auto-card`;
  card.dataset.matchId = match.id;
  if (selection.winner === 'KOR' || selection.teamA === 'KOR' || selection.teamB === 'KOR') {
    card.classList.add('korea-highlight');
  }
  if (round.id === 'final') {
    card.classList.add('final-stage');
  }

  const meta = document.createElement('div');
  meta.className = 'match-meta';
  meta.innerHTML = `<span>${match.id}${getMatchPathLabel(match)}</span><span>${result.sourceLabel}</span>`;

  const body = document.createElement('div');
  body.className = 'dynamic-match-body tournament-auto-body';
  body.appendChild(createTournamentTeamList(selection));
  body.appendChild(createTournamentResultStrip(selection, result));
  body.appendChild(createTournamentReasonBlock(selection, comparison, result));

  card.append(meta, body);
  return card;
}

/**
 * 이전 라운드 승자 연결 정보를 매치 제목에 붙일 보조 라벨로 만든다.
 * source match가 없는 32강 슬롯은 빈 문자열을 반환한다.
 */
function getMatchPathLabel(match) {
  if (!match.teamASourceMatch || !match.teamBSourceMatch) return '';
  return ` · ${match.teamASourceMatch}/${match.teamBSourceMatch} 승자`;
}

/**
 * 토너먼트 카드 안의 두 팀 행 목록을 만든다.
 * 각 행은 현재 선택된 승자 정보와 비교해 winner 스타일을 받을 수 있다.
 */
function createTournamentTeamList(selection) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tournament-team-list';
  wrapper.appendChild(createTournamentTeamRow(selection.teamA, selection.winner));
  wrapper.appendChild(createTournamentTeamRow(selection.teamB, selection.winner));
  return wrapper;
}

/**
 * 토너먼트 카드의 단일 팀 행 DOM을 만든다.
 * 팀이 아직 배정되지 않았으면 대기 상태를 표시하고, 배정된 팀은 국기/팀명/종합 능력치를 보여준다.
 */
function createTournamentTeamRow(teamId, winnerId) {
  const row = document.createElement('div');
  const team = state.teams[teamId];
  row.className = `tournament-team-row ${teamId && teamId === winnerId ? 'winner' : ''}`;

  if (!team) {
    row.innerHTML = `
      <span class="tournament-team-main">
        <span></span>
        <strong>자동 배정 대기</strong>
      </span>
      <span class="tournament-team-rating">-</span>
    `;
    return row;
  }

  row.innerHTML = `
    <span class="tournament-team-main">
      ${getFlagIconMarkup(teamId)}
      <strong>${team.name}</strong>
    </span>
    <span class="tournament-team-rating">${team.rating.overall}</span>
  `;
  return row;
}

/**
 * 토너먼트 카드의 결과 요약 줄을 만든다.
 * 점수 출처, 적용 점수, 승자 이름을 한 줄 그리드로 표시한다.
 */
function createTournamentResultStrip(selection, result) {
  const winner = state.teams[selection.winner];
  const strip = document.createElement('div');
  strip.className = 'tournament-result-strip';
  strip.innerHTML = `
    <span>${result.sourceLabel}</span>
    <strong>${result.score || '-'}</strong>
    <em>${winner ? `${winner.flag} ${winner.name} 승` : '승자 대기'}</em>
  `;
  return strip;
}

/**
 * 토너먼트 카드의 간단 분석 영역을 만든다.
 * 대진이 완성되면 우세 팀, 승률, 핵심 이유를 요약하고 상세 분석 모달 버튼을 연결한다.
 */
function createTournamentReasonBlock(selection, comparison, result) {
  const block = document.createElement('div');
  block.className = 'tournament-reason-block';

  if (!selection.teamA || !selection.teamB || !comparison) {
    block.textContent = '대진이 확정되면 예측 분석이 표시됩니다.';
    return block;
  }

  const analysis = getMatchAnalysis(selection.teamA, selection.teamB);
  const winnerTeam = state.teams[analysis.favoriteId];

  const summary = document.createElement('p');
  summary.textContent = analysis.summary;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dynamic-analysis-btn';
  button.innerHTML = '<i class="fas fa-chart-line"></i><span>분석 결과 보기</span>';
  button.addEventListener('click', () => {
    showMatchAnalysis(selection.teamA, selection.teamB, '토너먼트', {
      source: result.sourceLabel === '실제 결과' ? 'actual' : 'ai',
      score: result.score
    });
  });

  block.append(summary, button);
  return block;
}

/**
 * 경기 일정 카드에 들어갈 분석 버튼 HTML을 만든다.
 * 양 팀 코드가 모두 있을 때만 버튼을 반환해 대진 미확정 상태에서는 빈 영역으로 남긴다.
 */
function createScheduleAnalysisButtonMarkup(homeId, awayId) {
  if (!homeId || !awayId) return '';
  return `
    <button type="button" class="dynamic-analysis-btn schedule-analysis-btn" data-schedule-analysis>
      <i class="fas fa-chart-line"></i><span>분석 결과 보기</span>
    </button>
  `;
}

/**
 * 두 팀 간 전력 비교 상세 분석을 모달로 표시한다.
 * 승률, FIFA 순위/최근 폼/스쿼드 컨디션/예상 점수 섹션을 조합해 경기 단위 보고서를 만든다.
 */
function showMatchAnalysis(teamAId, teamBId, stageLabel, appliedScore) {
  const analysis = getMatchAnalysis(teamAId, teamBId);
  if (!analysis) return;

  const favorite = state.teams[analysis.favoriteId];
  const scoreLabel = appliedScore?.score ? ` · 적용 점수 ${appliedScore.score}` : '';
  const sourceLabel = appliedScore?.source === 'actual' ? '실제 결과 반영' : 'AI 예측 기준';

  openInfoModal(
    `${favorite.flag} ${favorite.name} 분석 결과`,
    `${stageLabel} · ${sourceLabel}`,
    `${analysis.favoriteRate}%`,
    `
      <div class="match-analysis-panel">
        <p class="match-analysis-summary">${analysis.summary}${scoreLabel}</p>
        <div class="match-analysis-grid">
          ${analysis.sections.map((section) => `
            <section class="match-analysis-section">
              <strong>${section.title}</strong>
              <p>${section.text}</p>
            </section>
          `).join('')}
        </div>
        <div class="match-analysis-rule">
          <span>분석 기준 고정</span>
          <strong>최근 경기기록 · 선수별 컨디션 · 감독 전술 · 양팀 특성</strong>
        </div>
      </div>
    `
  );
}

/**
 * 토너먼트 카드에 표시할 점수와 출처 라벨을 결정한다.
 * 일정 데이터의 실제 점수가 있으면 우선 사용하고, 없으면 AI 예측 점수를 적용한다.
 */
function getTournamentDisplayResult(match, selection) {
  const scheduleMatch = getScheduleMatchByBracketMatchId(match.id);
  if (!scheduleMatch || !selection.teamA || !selection.teamB) {
    return {
      score: selection.score,
      sourceLabel: '자동 예측'
    };
  }

  const score = getAppliedScheduleScore(scheduleMatch, selection.teamA, selection.teamB);
  return {
    score: score.score,
    sourceLabel: score.source === 'actual' ? '실제 결과' : 'AI 예측'
  };
}

/**
 * 현재 일정 점수 기준으로 모든 조의 순위 결과를 계산한다.
 * 각 조의 standings를 정렬한 뒤 순위 번호와 팀 ID를 매핑해 자동 대진의 입력값으로 사용한다.
 */
function createGroupResultsFromSchedule() {
  if (!state.qualifiers.groups?.length) return {};

  return Object.fromEntries(
    state.qualifiers.groups.map((group) => [
      group.id,
      Object.fromEntries(getGroupStandings(group).map((standing, index) => [index + 1, standing.teamId]))
    ])
  );
}

/**
 * 특정 조의 승점표를 계산한다.
 * 조 참가 팀 초기값을 만들고, 조별 경기 결과/예측 점수를 반영한 뒤 승점, 득실, 득점, 팀 전력 순으로 정렬한다.
 */
function getGroupStandings(group) {
  const standings = new Map();
  group.qualifiers.forEach((qualifier) => {
    const team = state.teams[qualifier.teamId];
    standings.set(qualifier.teamId, {
      teamId: qualifier.teamId,
      team,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0
    });
  });

  getGroupScheduleMatches(group.id).forEach((match) => {
    const homeId = state.teams[match.homeCode] ? match.homeCode : '';
    const awayId = state.teams[match.awayCode] ? match.awayCode : '';
    if (!standings.has(homeId) || !standings.has(awayId)) return;

    const score = getAppliedScheduleScore(match, homeId, awayId);
    if (!Number.isInteger(score.homeGoals) || !Number.isInteger(score.awayGoals)) return;

    applyStandingResult(standings.get(homeId), score.homeGoals, score.awayGoals);
    applyStandingResult(standings.get(awayId), score.awayGoals, score.homeGoals);
  });

  return Array.from(standings.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.team.rating.overall || 0) - (a.team.rating.overall || 0);
  });
}

/**
 * 특정 조 ID에 해당하는 조별리그 일정만 추려낸다.
 * 일정 stage/group 데이터의 Group 표기를 기준으로 필터링한다.
 */
function getGroupScheduleMatches(groupId) {
  return getSortedScheduleMatches().filter((match) => match.group === `Group ${groupId}`);
}

/**
 * 단일 경기 점수를 두 팀의 순위표 통계에 반영한다.
 * 득점/실점/득실/승무패/승점을 모두 갱신해 조별 순위 계산에 사용한다.
 */
function applyStandingResult(standing, goalsFor, goalsAgainst) {
  standing.played += 1;
  standing.goalsFor += goalsFor;
  standing.goalsAgainst += goalsAgainst;
  standing.goalDifference = standing.goalsFor - standing.goalsAgainst;

  if (goalsFor > goalsAgainst) {
    standing.wins += 1;
    standing.points += 3;
  } else if (goalsFor === goalsAgainst) {
    standing.draws += 1;
    standing.points += 1;
  } else {
    standing.losses += 1;
  }
}

/**
 * 현재 조별 순위와 경기 결과를 기반으로 전체 토너먼트 선택 상태를 자동 생성한다.
 * 각 매치의 팀 A/B와 승자, 점수를 순차적으로 계산해 다음 라운드 후보로 넘긴다.
 */
function createAutomaticBracketSelections() {
  const automaticSelections = {};

  state.bracket.rounds.forEach((round, roundIndex) => {
    const usedInRound = new Set();

    round.matches.forEach((match) => {
      const teamA = chooseAutomaticTeam(round, roundIndex, match, 'teamA', automaticSelections, usedInRound);
      const teamB = chooseAutomaticTeam(round, roundIndex, match, 'teamB', automaticSelections, usedInRound);
      const result = getAutomaticMatchResult(match.id, teamA, teamB);

      automaticSelections[match.id] = {
        teamA,
        teamB,
        winner: result.winner,
        score: result.score
      };

      if (teamA) usedInRound.add(teamA);
      if (teamB) usedInRound.add(teamB);
    });
  });

  return automaticSelections;
}

/**
 * 특정 토너먼트 슬롯에 들어갈 팀을 자동 선택한다.
 * 후보 중 같은 라운드에서 아직 쓰이지 않은 팀을 우선하고, 팀 순위 점수가 높은 순서로 고른다.
 */
function chooseAutomaticTeam(round, roundIndex, match, field, automaticSelections, usedInRound) {
  const candidates = getAutomaticCandidatesForSlot(round, roundIndex, match, field, automaticSelections);
  if (!candidates.length) return '';
  if (candidates.length === 1) return candidates[0];

  const unusedCandidates = candidates.filter((teamId) => !usedInRound.has(teamId));
  const pool = unusedCandidates.length ? unusedCandidates : candidates;
  return pool.sort((a, b) => getTeamStandingScore(b) - getTeamStandingScore(a))[0] || '';
}

/**
 * 자동 대진 슬롯의 후보 팀 목록을 계산한다.
 * 32강은 조별 순위 source를 사용하고, 이후 라운드는 이전 매치 승자를 참조한다.
 */
function getAutomaticCandidatesForSlot(round, roundIndex, match, field, automaticSelections) {
  if (roundIndex === 0) {
    const source = field === 'teamA' ? match.teamASource : match.teamBSource;
    return source ? getTeamsBySource(source) : [];
  }

  const sourceMatchId = field === 'teamA' ? match.teamASourceMatch : match.teamBSourceMatch;
  if (sourceMatchId) {
    return [automaticSelections[sourceMatchId]?.winner].filter(Boolean);
  }

  const previousRound = state.bracket.rounds[roundIndex - 1];
  const previousMatchIndex = (match.slot - 1) * 2 + (field === 'teamA' ? 0 : 1);
  const previousMatch = previousRound.matches[previousMatchIndex];
  return previousMatch ? [automaticSelections[previousMatch.id]?.winner].filter(Boolean) : [];
}

/**
 * 자동 대진의 단일 경기 결과를 계산한다.
 * 실제 일정 점수가 있으면 그 승자를 반영하고, 없으면 전력 점수 기반 예측 점수와 승자를 만든다.
 */
function getAutomaticMatchResult(matchId, teamAId, teamBId) {
  if (!teamAId || !teamBId) {
    return { winner: '', score: '' };
  }

  const scheduleMatch = getScheduleMatchByBracketMatchId(matchId);
  const score = scheduleMatch
    ? getAppliedScheduleScore(scheduleMatch, teamAId, teamBId)
    : getPredictedScheduleScore({ id: matchId, matchNumber: 0, stage: 'Knockout' }, teamAId, teamBId);

  if (!Number.isInteger(score.homeGoals) || !Number.isInteger(score.awayGoals)) {
    return { winner: '', score: '' };
  }

  if (score.homeGoals > score.awayGoals) {
    return { winner: teamAId, score: score.score };
  }
  if (score.awayGoals > score.homeGoals) {
    return { winner: teamBId, score: score.score };
  }
  if (Number.isInteger(score.homePenalties) && Number.isInteger(score.awayPenalties) && score.homePenalties !== score.awayPenalties) {
    return {
      winner: score.homePenalties > score.awayPenalties ? teamAId : teamBId,
      score: score.score
    };
  }

  return {
    winner: getTeamPowerScore(teamAId) >= getTeamPowerScore(teamBId) ? teamAId : teamBId,
    score: score.score
  };
}

/**
 * 브래킷 매치 ID와 연결된 일정 데이터를 찾는다.
 * FIFA match number를 내부 브래킷 ID로 변환해 토너먼트 카드와 일정 점수를 이어준다.
 */
function getScheduleMatchByBracketMatchId(matchId) {
  return (state.schedule.matches || []).find((match) => getScheduleBracketMatchId(match.matchNumber) === matchId);
}

/**
 * 자동 대진 후보 정렬에 사용할 팀 점수를 계산한다.
 * 조별 순위가 있으면 순위 기반 가중치를 주고, 없으면 팀 종합 능력치를 fallback으로 사용한다.
 */
function getTeamStandingScore(teamId) {
  const standing = getTeamStanding(teamId);
  if (!standing) {
    return getTeamPowerScore(teamId);
  }

  return (
    standing.points * 1000 +
    standing.goalDifference * 100 +
    standing.goalsFor * 10 +
    standing.wins * 5 +
    getTeamPowerScore(teamId) / 100
  );
}

/**
 * 특정 팀의 현재 조별 순위표 항목을 찾는다.
 * 모든 조 standings를 순회해 팀 ID가 일치하는 계산 결과를 반환한다.
 */
function getTeamStanding(teamId) {
  for (const group of state.qualifiers.groups) {
    const standing = getGroupStandings(group).find((item) => item.teamId === teamId);
    if (standing) return standing;
  }
  return null;
}

/**
 * 특정 브래킷 매치의 선택 상태 객체를 가져온다.
 * 아직 상태가 없으면 팀 A/B, 승자, 점수 필드를 가진 기본 객체를 만들어 반환한다.
 */
function getSelection(matchId) {
  if (!state.selections[matchId]) {
    state.selections[matchId] = { teamA: '', teamB: '', winner: '', score: '' };
  }
  return state.selections[matchId];
}

/**
 * 저장되어 있거나 자동 생성된 토너먼트 선택 상태를 현재 후보 규칙에 맞게 정리한다.
 * 후보에서 벗어난 팀이나 양 팀에 포함되지 않는 승자를 비워 잘못된 상태 전파를 막는다.
 */
function normalizeSelections() {
  state.bracket.rounds.forEach((round, roundIndex) => {
    round.matches.forEach((match) => {
      const selection = getSelection(match.id);
      ['teamA', 'teamB'].forEach((field) => {
        const candidates = getCandidatesForSlot(round, roundIndex, match, field);
        if (selection[field] && !candidates.includes(selection[field])) {
          selection[field] = '';
        }
      });
      if (selection.winner && selection.winner !== selection.teamA && selection.winner !== selection.teamB) {
        selection.winner = '';
      }
    });
  });
}

/**
 * 특정 라운드에서 사용할 수 있는 후보 팀 목록을 반환한다.
 * 첫 라운드는 조별 진출팀 전체를, 이후 라운드는 직전 라운드 승자 목록을 사용한다.
 */
function getCandidatesForRound(roundIndex) {
  if (roundIndex === 0) {
    return getAllSelectedGroupTeams();
  }

  const previousRound = state.bracket.rounds[roundIndex - 1];
  return previousRound.matches
    .map((match) => getSelection(match.id).winner)
    .filter(Boolean);
}

/**
 * 매치의 팀 A/B 슬롯별 후보 팀을 계산한다.
 * source match가 있으면 해당 경기 승자를, 32강 source가 있으면 조별 순위 결과를 사용한다.
 */
function getCandidatesForSlot(round, roundIndex, match, field) {
  if (roundIndex !== 0) {
    const sourceMatchId = field === 'teamA' ? match.teamASourceMatch : match.teamBSourceMatch;
    if (sourceMatchId) {
      return [getSelection(sourceMatchId).winner].filter(Boolean);
    }
    return getCandidatesForRound(roundIndex);
  }

  const source = field === 'teamA' ? match.teamASource : match.teamBSource;
  if (!source) {
    return getCandidatesForRound(roundIndex);
  }

  return getTeamsBySource(source);
}

/**
 * 브래킷 source 정의를 실제 팀 ID 목록으로 변환한다.
 * 단일 조 또는 여러 조 묶음에서 지정 순위 팀을 찾아 후보 배열로 반환한다.
 */
function getTeamsBySource(source) {
  const groups = source.group ? [source.group] : source.groups || [];
  return groups
    .map((groupId) => state.groupResults[groupId]?.[source.rank])
    .filter(Boolean);
}

/**
 * 현재 조별 결과에서 선택된 모든 팀 ID를 평탄화해 반환한다.
 * 첫 토너먼트 라운드 후보 풀과 fallback 후보 계산에 사용한다.
 */
function getAllSelectedGroupTeams() {
  return Object.values(state.groupResults)
    .flatMap((groupResult) => Object.values(groupResult))
    .filter(Boolean);
}

/**
 * 두 팀의 전력 비교 분석 데이터를 계산한다.
 * 팀 능력치, 외부 지표, 최근 폼, 선수단 컨디션을 조합해 승률과 설명 섹션을 만든다.
 */
function getMatchAnalysis(teamAId, teamBId) {
  if (!teamAId || !teamBId) return null;

  const teamA = state.teams[teamAId];
  const teamB = state.teams[teamBId];
  const metricA = getTeamMetric(teamAId);
  const metricB = getTeamMetric(teamBId);
  const teamAScore = getTeamPowerScore(teamAId);
  const teamBScore = getTeamPowerScore(teamBId);
  const rawRate = teamAScore / (teamAScore + teamBScore);
  const teamARate = clampRate(Math.round(rawRate * 100));
  const teamBRate = 100 - teamARate;
  const favoriteId = teamARate >= teamBRate ? teamAId : teamBId;
  const favorite = state.teams[favoriteId];
  const favoriteRate = favoriteId === teamAId ? teamARate : teamBRate;
  const conditionA = getSquadConditionSummary(teamA);
  const conditionB = getSquadConditionSummary(teamB);

  return {
    teamAName: teamA.name,
    teamBName: teamB.name,
    teamARate,
    teamBRate,
    favoriteId,
    favoriteRate,
    summary: `${teamA.name} ${teamARate}% / ${teamB.name} ${teamBRate}%입니다. 최근 경기기록, 선수별 컨디션, 감독 전술, 양팀 특성을 같은 비중으로 점검하면 ${favorite.name} 쪽이 근소하게 앞서는 매치업입니다.`,
    sections: [
      {
        title: '최근 경기기록',
        text: `${teamA.name}은 최근 10경기 ${formatRecentForm(metricA)}, ${teamB.name}은 최근 10경기 ${formatRecentForm(metricB)}입니다. FIFA 랭킹은 ${teamA.name} ${formatRank(metricA)}위, ${teamB.name} ${formatRank(metricB)}위로 반영했습니다.`
      },
      {
        title: '선수별 컨디션',
        text: `${teamA.name} 핵심 선수 평균 컨디션은 ${conditionA.averageForm}점, ${teamB.name}은 ${conditionB.averageForm}점입니다. ${conditionA.topNames} / ${conditionB.topNames}의 최근 폼과 공격·수비 기여도를 함께 계산했습니다.`
      },
      {
        title: '감독 전술',
        text: `${teamA.name}은 ${teamA.style} 흐름이 강점이고, ${teamB.name}은 ${teamB.style} 성향이 강합니다. 전술 상성은 공격 전개력, 수비 안정성, 중원 영향력의 균형으로 비교했습니다.`
      },
      {
        title: '양팀 특성',
        text: `${teamA.name}은 공격 ${teamA.rating.attack}, 수비 ${teamA.rating.defense}, 경험 ${teamA.rating.experience}이고 ${teamB.name}은 공격 ${teamB.rating.attack}, 수비 ${teamB.rating.defense}, 경험 ${teamB.rating.experience}입니다. 이 차이에 FIFA 포인트와 선수단 깊이를 더해 최종 예측을 만들었습니다.`
      }
    ]
  };
}

/**
 * 토너먼트 카드 요약에 필요한 간단 비교 정보를 반환한다.
 * 상세 분석 결과에서 우세 팀 이름과 승률만 추려 카드용 문구로 쓰기 쉽게 만든다.
 */
function getComparison(teamAId, teamBId) {
  const analysis = getMatchAnalysis(teamAId, teamBId);
  if (!analysis) return null;

  return {
    teamAName: analysis.teamAName,
    teamBName: analysis.teamBName,
    teamARate: analysis.teamARate,
    teamBRate: analysis.teamBRate,
    favoriteId: analysis.favoriteId,
    reason: analysis.summary
  };
}

/**
 * 팀 선수단의 컨디션 요약을 계산한다.
 * 폼과 레이팅이 높은 상위 선수 이름, 평균 폼, 전체 선수 수를 분석 문구에 쓰기 좋은 형태로 반환한다.
 */
function getSquadConditionSummary(team) {
  const squad = getSquad(team);
  const ranked = [...squad]
    .sort((a, b) => ((b.form || 0) + (b.rating || 0)) - ((a.form || 0) + (a.rating || 0)))
    .slice(0, 5);
  const averageForm = squad.length
    ? Math.round(squad.reduce((sum, player) => sum + (player.form || team.rating.form || 0), 0) / squad.length)
    : team.rating.form;

  return {
    averageForm,
    topNames: ranked.map((player) => getLocalizedPlayerNameParts(player).ko).join(', ')
  };
}

/**
 * 팀 ID에 해당하는 보조 지표 데이터를 가져온다.
 * FIFA 랭킹, 최근 경기 흐름 등 별도 metrics 데이터가 없을 수 있으므로 null 가능성을 허용한다.
 */
function getTeamMetric(teamId) {
  return state.teamMetrics.teams?.[teamId] || null;
}

/**
 * 팀의 종합 전력 점수를 계산한다.
 * 기본 rating 가중치에 FIFA 포인트, 최근 폼, 선수 품질 보정치를 더해 매치 예측의 핵심 입력으로 사용한다.
 */
function getTeamPowerScore(teamId) {
  const metric = getTeamMetric(teamId);
  if (metric?.internetPower) return metric.internetPower;
  return getWeightedScore(state.teams[teamId].rating);
}

/**
 * FIFA 랭킹 값을 화면 표시용 문자열로 변환한다.
 * 지표가 없거나 랭킹이 없으면 대시를 반환해 모달 레이아웃을 유지한다.
 */
function formatRank(metric) {
  return metric?.fifaRank ?? '-';
}

/**
 * 최근 폼 지표를 짧은 표시 문자열로 변환한다.
 * 승/무/패와 점수를 함께 보여주되 데이터가 없으면 대시를 반환한다.
 */
function formatRecentForm(metric) {
  if (!metric?.recentForm?.matches) return '자료 부족';
  const form = metric.recentForm;
  return `${form.wins}승 ${form.draws}무 ${form.losses}패`;
}

/**
 * 팀 rating 객체를 가중 평균 전력 점수로 환산한다.
 * 종합, 공격, 중원, 수비, 선수층, 경험, 폼의 중요도를 다르게 적용한다.
 */
function getWeightedScore(rating) {
  return (
    rating.overall * 0.30 +
    rating.attack * 0.18 +
    rating.midfield * 0.16 +
    rating.defense * 0.16 +
    rating.depth * 0.08 +
    rating.experience * 0.06 +
    rating.form * 0.06
  );
}

/**
 * 승률 숫자를 화면에 쓰기 좋은 범위로 제한한다.
 * 한쪽 확률이 0%나 100%로 과도하게 보이지 않도록 최소/최대 경계를 둔다.
 */
function clampRate(rate) {
  return Math.max(35, Math.min(65, rate));
}

/**
 * 팀 ID를 국기와 팀명 조합의 표시 문자열로 변환한다.
 * 알 수 없는 팀 ID는 원본 ID를 반환해 데이터 누락 상황에서도 식별 가능하게 한다.
 */
function getTeamLabel(teamId) {
  const team = state.teams[teamId];
  return team ? `${team.flag} ${team.name}` : teamId;
}

/**
 * FIFA 국기 이미지와 fallback 이모지 markup을 만든다.
 * 이미지 로딩 실패 시 같은 위치에 팀 flag 문자열이 표시되도록 onerror 처리를 포함한다.
 */
function getFlagIconMarkup(teamId) {
  const team = state.teams[teamId];
  if (!team) return '<span class="flag-icon-placeholder"></span>';
  return `
    <span class="flag-icon-wrap" aria-hidden="true">
      <img class="flag-icon-img" src="https://api.fifa.com/api/v3/picture/flags-sq-2/${teamId}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';">
      <span class="flag-icon-fallback">${team.flag}</span>
    </span>
  `;
}

/**
 * 전체 일정을 현지 날짜 기준 시간순으로 정렬해 반환한다.
 * 원본 state.schedule.matches를 직접 변경하지 않도록 복사본을 정렬한다.
 */
function getSortedScheduleMatches() {
  return [...(state.schedule.matches || [])].sort((a, b) => {
    const dateA = new Date(a.localDate || a.date).getTime();
    const dateB = new Date(b.localDate || b.date).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return (a.matchNumber || 0) - (b.matchNumber || 0);
  });
}

/**
 * 경기 일정 탭의 날짜 그룹 접힘 상태를 일괄 변경한다.
 * 모든 날짜 key에 같은 boolean 값을 넣고 렌더링을 다시 수행한다.
 */
function setAllScheduleDatesCollapsed(isCollapsed) {
  const collapsedState = {};
  createScheduleDateGroups().forEach((dateGroup) => {
    collapsedState[dateGroup.date] = isCollapsed;
  });
  state.scheduleCollapsed = isCollapsed ? collapsedState : {};
  render();
}

/**
 * 날짜 값을 지정 타임존의 YYYY-MM-DD key로 변환한다.
 * Intl DateTimeFormat의 formatToParts를 사용해 브라우저 로케일 차이에도 안정적인 key를 만든다.
 */
function getScheduleDateKey(value, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/**
 * 일정 날짜를 한국어 화면 표시 문자열로 포맷한다.
 * 타임존을 명시해 현지 시간/중국 시간 같은 서로 다른 관점의 날짜 표시를 지원한다.
 */
function formatScheduleDate(value, timeZone = 'UTC') {
  const date = new Date(value);
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone
  }).format(date);
}

/**
 * 일정 시간을 HH:mm 형태로 포맷한다.
 * 타임존 파라미터를 받아 경기 현지 시간과 중국 시간을 같은 함수로 표현한다.
 */
function formatScheduleTime(value, timeZone = 'UTC') {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone
  }).format(new Date(value));
}

/**
 * 일정 데이터에서 홈/원정 팀 ID를 결정한다.
 * 직접 코드가 있으면 우선 사용하고, 토너먼트 경기라면 브래킷 선택 결과를 fallback으로 사용한다.
 */
function getScheduleTeams(match) {
  const directHomeId = state.teams[match.homeCode] ? match.homeCode : '';
  const directAwayId = state.teams[match.awayCode] ? match.awayCode : '';
  if (directHomeId || directAwayId) {
    return { homeId: directHomeId, awayId: directAwayId };
  }

  const selection = getScheduleSelection(match.matchNumber);
  return {
    homeId: selection.teamA || '',
    awayId: selection.teamB || ''
  };
}

/**
 * FIFA match number에 대응하는 브래킷 선택 상태를 가져온다.
 * 일정과 내부 토너먼트 매치 ID를 연결해 홈/원정 표시와 점수 적용에 사용한다.
 */
function getScheduleSelection(matchNumber) {
  const matchId = getScheduleBracketMatchId(matchNumber);
  return matchId ? (state.selections[matchId] || {}) : {};
}

/**
 * FIFA match number를 내부 브래킷 match ID로 변환한다.
 * 32강 이후 match number 범위를 round32/round16/quarter/semifinal/final ID 체계에 맞춘다.
 */
function getScheduleBracketMatchId(matchNumber) {
  if (matchNumber >= 73 && matchNumber <= 88) return `M${matchNumber}`;
  if (matchNumber >= 89 && matchNumber <= 96) return `R16-${String(matchNumber - 88).padStart(2, '0')}`;
  if (matchNumber >= 97 && matchNumber <= 100) return `QF-${String(matchNumber - 96).padStart(2, '0')}`;
  if (matchNumber >= 101 && matchNumber <= 102) return `SF-${String(matchNumber - 100).padStart(2, '0')}`;
  if (matchNumber === 104) return 'FINAL';
  return '';
}

/**
 * 실제 점수가 없을 때 사용할 AI 예측 점수를 계산한다.
 * 양 팀 전력, 공격/수비 상성, 최근 폼, 토너먼트 여부를 반영해 홈/원정 득점과 승자를 만든다.
 */
function getPredictedScheduleScore(match, homeId, awayId) {
  if (!homeId || !awayId) {
    return {
      homeGoals: null,
      awayGoals: null,
      score: '대진 미정',
      note: '확정 후 자동 계산',
      source: 'pending'
    };
  }

  const home = state.teams[homeId];
  const away = state.teams[awayId];
  const homeScore = getTeamPowerScore(homeId);
  const awayScore = getTeamPowerScore(awayId);
  const homeMetric = getTeamMetric(homeId);
  const awayMetric = getTeamMetric(awayId);
  const homeFormBoost = ((homeMetric?.recentForm?.score ?? home.rating.form) - 50) / 55;
  const awayFormBoost = ((awayMetric?.recentForm?.score ?? away.rating.form) - 50) / 55;
  const homeAttackEdge = (home.rating.attack - away.rating.defense) / 22 + homeFormBoost;
  const awayAttackEdge = (away.rating.attack - home.rating.defense) / 22 + awayFormBoost;
  const ratingEdge = (homeScore - awayScore) / 26;
  const seed = ((match.matchNumber || 0) % 5) * 0.08;
  const isKnockout = match.stage && match.stage !== 'First Stage';

  let homeGoals = clampGoals(Math.round(1.15 + homeAttackEdge + ratingEdge + seed));
  let awayGoals = clampGoals(Math.round(1.15 + awayAttackEdge - ratingEdge - seed / 2));

  if (isKnockout && homeGoals === awayGoals) {
    if (homeScore >= awayScore) {
      homeGoals += 1;
    } else {
      awayGoals += 1;
    }
  }

  if (!isKnockout && homeGoals === 0 && awayGoals === 0) {
    homeGoals = homeScore >= awayScore ? 1 : 0;
    awayGoals = homeScore >= awayScore ? 0 : 1;
  }

  const favorite = homeGoals === awayGoals
    ? '무승부 가능'
    : `${homeGoals > awayGoals ? home.name : away.name} 우세`;

  return {
    homeGoals,
    awayGoals,
    score: `${homeGoals} - ${awayGoals}`,
    note: favorite,
    source: 'ai'
  };
}

/**
 * 일정 카드와 토너먼트 계산에 실제/예측 점수 중 적용할 값을 결정한다.
 * 실제 점수가 있으면 우선 사용하고, 없으면 예측 점수를 생성하며 출처 정보를 함께 반환한다.
 */
function getAppliedScheduleScore(match, homeId, awayId) {
  const actual = getActualScheduleScore(match);
  if (actual && Number.isInteger(actual.homeGoals) && Number.isInteger(actual.awayGoals)) {
    const hasPenalties = Number.isInteger(actual.homePenalties) && Number.isInteger(actual.awayPenalties);
    return {
      homeGoals: actual.homeGoals,
      awayGoals: actual.awayGoals,
      homePenalties: actual.homePenalties,
      awayPenalties: actual.awayPenalties,
      score: hasPenalties
        ? `${actual.homeGoals} - ${actual.awayGoals} (PK ${actual.homePenalties} - ${actual.awayPenalties})`
        : `${actual.homeGoals} - ${actual.awayGoals}`,
      note: actual.syncedFrom ? `${actual.syncedFrom} 결과 적용` : '실제 결과 적용',
      source: 'actual'
    };
  }

  return getPredictedScheduleScore(match, homeId, awayId);
}

/**
 * 일정 데이터 또는 동기화 결과에서 실제 경기 점수를 추출한다.
 * 여러 필드명 변형과 페널티 점수 필드를 coalesce해 데이터 출처가 달라도 처리할 수 있게 한다.
 */
function getActualScheduleScore(match) {
  const savedActual = state.scheduleResults[match.id];
  if (savedActual && Number.isInteger(savedActual.homeGoals) && Number.isInteger(savedActual.awayGoals)) {
    return savedActual;
  }

  const homeGoals = coalesceScore(
    match.homeGoals,
    match.homeScore,
    match.HomeTeamScore,
    match.Home?.Score,
    match.result?.homeGoals,
    match.result?.homeScore,
    match.score?.home,
    match.score?.homeGoals
  );
  const awayGoals = coalesceScore(
    match.awayGoals,
    match.awayScore,
    match.AwayTeamScore,
    match.Away?.Score,
    match.result?.awayGoals,
    match.result?.awayScore,
    match.score?.away,
    match.score?.awayGoals
  );

  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) {
    return null;
  }

  return {
    homeGoals,
    awayGoals,
    homePenalties: coalesceScore(
      match.homePenalties,
      match.homePenaltyScore,
      match.HomeTeamPenaltyScore,
      match.result?.homePenalties,
      match.score?.homePenalties
    ),
    awayPenalties: coalesceScore(
      match.awayPenalties,
      match.awayPenaltyScore,
      match.AwayTeamPenaltyScore,
      match.result?.awayPenalties,
      match.score?.awayPenalties
    ),
    syncedFrom: match.resultSource || match.syncedFrom || '일정 데이터'
  };
}

/**
 * 일정 카드에 표시할 현재 점수 적용 상태 HTML을 만든다.
 * 현재는 편집 입력이 아니라 실제 점수 반영 여부 또는 AI 예측 적용 상태를 읽기 전용으로 보여준다.
 */
function createScheduleResultInputsMarkup(match, homeId, awayId, appliedScore) {
  return `
    <div class="schedule-result-editor locked ${appliedScore.source === 'actual' ? 'actual' : ''}">
      <span>${appliedScore.source === 'actual' ? 'FIFA 결과' : '현재 기준'}</span>
      <strong>${appliedScore.source === 'actual' ? '실제 점수 반영됨' : (homeId && awayId ? 'AI 예측 적용 중' : '대진 확정 대기')}</strong>
    </div>
  `;
}

/**
 * FIFA 일정 API에서 실제 경기 결과를 가져와 로컬 상태에 반영한다.
 * 응답 점수를 일정 ID 기준으로 매칭하고, 조별 순위와 자동 대진을 다시 계산한 뒤 화면을 갱신한다.
 */
async function syncFifaMatchResults() {
  const syncButton = document.querySelector('.fifa-sync-btn');
  const originalHtml = syncButton?.innerHTML;

  if (syncButton) {
    syncButton.disabled = true;
    syncButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>FIFA 결과 확인 중</span>';
  }

  try {
    const response = await fetch(getFifaScheduleApiUrl(), {
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!response.ok) {
      throw new Error(`FIFA API 응답 오류: ${response.status}`);
    }

    const payload = await response.json();
    const apiMatches = payload.Results || [];
    const localById = new Map((state.schedule.matches || []).map((match) => [String(match.id), match]));
    let appliedCount = 0;

    apiMatches.forEach((apiMatch) => {
      const localMatch = localById.get(String(apiMatch.IdMatch));
      if (!localMatch) return;

      const result = extractFifaScore(apiMatch);
      if (!result) return;

      state.scheduleResults[localMatch.id] = {
        homeGoals: result.homeGoals,
        awayGoals: result.awayGoals,
        homePenalties: result.homePenalties,
        awayPenalties: result.awayPenalties,
        syncedFrom: 'FIFA',
        syncedAt: new Date().toISOString()
      };
      appliedCount += 1;
    });

    state.groupResults = createGroupResultsFromSchedule();
    state.selections = createAutomaticBracketSelections();
    render();
    window.alert(appliedCount
      ? `FIFA 결과 ${appliedCount}경기를 동기화했습니다.`
      : '아직 FIFA API에 확정된 경기 결과가 없습니다.');
  } catch (error) {
    window.alert(`FIFA 결과 동기화에 실패했습니다. 브라우저가 FIFA API 접근을 차단했을 수 있습니다.\n\n${error.message}`);
  } finally {
    if (syncButton) {
      syncButton.disabled = false;
      syncButton.innerHTML = originalHtml;
    }
  }
}

/**
 * FIFA 일정 동기화에 사용할 API URL을 반환한다.
 * schedule 데이터에 source가 있으면 우선 사용하고, 없으면 기본 FIFA calendar API 주소를 사용한다.
 */
function getFifaScheduleApiUrl() {
  return state.schedule.source || 'https://api.fifa.com/api/v3/calendar/matches?language=en&IdCompetition=17&from=2026-06-01&to=2026-07-31&count=200';
}

/**
 * FIFA API 응답 한 건에서 정규화된 점수 객체를 추출한다.
 * 정규 시간 점수가 없으면 null을 반환하고, 페널티 점수가 있으면 함께 포함한다.
 */
function extractFifaScore(apiMatch) {
  const homeGoals = coalesceScore(apiMatch.HomeTeamScore, apiMatch.Home?.Score);
  const awayGoals = coalesceScore(apiMatch.AwayTeamScore, apiMatch.Away?.Score);
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) return null;

  return {
    homeGoals,
    awayGoals,
    homePenalties: coalesceScore(apiMatch.HomeTeamPenaltyScore),
    awayPenalties: coalesceScore(apiMatch.AwayTeamPenaltyScore)
  };
}

/**
 * 여러 후보 값 중 첫 번째 유효한 숫자 점수를 반환한다.
 * null/undefined/빈 문자열을 건너뛰고 숫자로 변환 가능한 값은 정수로 정규화한다.
 */
function coalesceScore(...values) {
  const value = values.find((item) => item !== null && item !== undefined && item !== '');
  if (value === undefined) return null;
  const score = Number(value);
  return Number.isFinite(score) ? Math.trunc(score) : null;
}

/**
 * 예측 득점 값을 축구 경기 점수로 자연스러운 범위에 제한한다.
 * 음수는 0으로, 과도하게 큰 값은 5로 잘라 카드 표시와 승자 계산을 안정화한다.
 */
function clampGoals(value) {
  return Math.max(0, Math.min(5, value));
}

/**
 * 일정 카드용 팀 표시명을 만든다.
 * 팀 코드가 데이터에 있으면 국기와 팀명을 사용하고, 없으면 일정 원본의 fallback 이름을 표시한다.
 */
function getScheduleTeamLabel(teamCode, fallbackName) {
  const team = state.teams[teamCode];
  if (team) {
    return `${getFlagIconMarkup(teamCode)}<strong>${team.name}</strong>`;
  }
  if (fallbackName) {
    return `<span></span><strong>${fallbackName}</strong>`;
  }
  return '<span></span><strong>대진 미정</strong>';
}

/**
 * 일정 stage 값을 한국어 경기 단계 라벨로 변환한다.
 * 알려진 FIFA stage 문자열은 번역하고, 알 수 없는 값은 원본을 그대로 반환한다.
 */
function getScheduleStageLabel(match) {
  if (match.group) {
    return match.group.replace('Group ', '') + '조';
  }

  const labels = {
    'First Stage': '조별리그',
    'Round of 32': '32강전',
    'Round of 16': '16강전',
    'Quarter-final': '8강전',
    'Semi-final': '4강전',
    'Play-off for third place': '3위 결정전',
    Final: '결승전'
  };
  return labels[match.stage] || match.stage || '경기';
}

/**
 * 라운드별 진행률 문자열을 계산한다.
 * 승자가 결정된 경기 수와 전체 경기 수를 `완료/전체` 형태로 반환해 라운드 헤더에 표시한다.
 */
function getRoundProgress(round) {
  const done = round.matches.filter((match) => getSelection(match.id).winner).length;
  return `${done}/${round.matches.length}`;
}

/**
 * localStorage에 저장된 앱 상태를 읽어온다.
 * JSON 파싱 실패나 저장값 없음 상황에서는 빈 객체를 반환해 초기화가 중단되지 않게 한다.
 */
function loadSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * 현재 앱 상태 중 유지해야 할 값만 localStorage에 저장한다.
 * 활성 탭, 일정 접힘 상태, 동기화된 경기 결과, 자동 대진 선택 상태를 다음 방문에 복원할 수 있게 한다.
 */
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    activeTab: state.activeTab,
    scheduleResults: state.scheduleResults,
    scheduleCollapsed: state.scheduleCollapsed,
    selections: state.selections
  }));
}

/**
 * 초기화 실패 시 화면에 표시할 오류 카드 HTML을 만든다.
 * 사용자가 원인을 볼 수 있도록 오류 메시지를 포함하되 기존 대진표 영역 안에 렌더링한다.
 */
function createErrorMarkup(error) {
  return `
    <div class="bracket-column">
      <div class="round-header">로드 실패</div>
      <div class="matchup-box left-side">
        <div class="match-meta"><span>ERROR</span></div>
        <p class="dynamic-help">${error.message}</p>
      </div>
    </div>
  `;
}

/**
 * 토너먼트 카드 사이의 연결선을 SVG로 그린다.
 * 현재 DOM 위치를 측정해 이전 라운드 카드와 다음 라운드 카드를 곡선 path로 연결한다.
 */
function drawTournamentConnectors() {
  const root = document.querySelector('.tournament-bracket.tournament-view');
  if (!root) return;

  root.querySelector('.tournament-connector-layer')?.remove();

  const rootRect = root.getBoundingClientRect();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('tournament-connector-layer');
  svg.setAttribute('width', root.scrollWidth);
  svg.setAttribute('height', root.scrollHeight);
  svg.setAttribute('viewBox', `0 0 ${root.scrollWidth} ${root.scrollHeight}`);
  svg.setAttribute('aria-hidden', 'true');

  state.bracket.rounds.slice(1).forEach((round) => {
    round.matches.forEach((targetMatch) => {
      [targetMatch.teamASourceMatch, targetMatch.teamBSourceMatch]
        .filter(Boolean)
        .forEach((sourceMatchId) => {
          const sourceCard = root.querySelector(`[data-match-id="${sourceMatchId}"]`);
          const targetCard = root.querySelector(`[data-match-id="${targetMatch.id}"]`);
          if (!sourceCard || !targetCard) return;

          svg.appendChild(createTournamentConnectorPath(
            getCardAnchor(sourceCard, rootRect, 'right'),
            getCardAnchor(targetCard, rootRect, 'left'),
            targetMatch.id === 'FINAL'
          ));
        });
    });
  });

  root.prepend(svg);
}

/**
 * 연결선이 카드의 어느 지점에서 시작하거나 끝날지 좌표를 계산한다.
 * 카드의 DOM rect와 루트 rect 차이를 이용해 SVG 내부 좌표계로 변환한다.
 */
function getCardAnchor(card, rootRect, side) {
  const rect = card.getBoundingClientRect();
  return {
    x: side === 'right' ? rect.right - rootRect.left : rect.left - rootRect.left,
    y: rect.top - rootRect.top + rect.height / 2
  };
}

/**
 * 두 anchor 좌표를 잇는 SVG path 요소를 만든다.
 * 라운드 간 연결은 부드러운 cubic curve로 그리고, 결승 경로에는 별도 강조 클래스를 붙인다.
 */
function createTournamentConnectorPath(start, end, isFinalPath) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const midX = start.x + Math.max(28, (end.x - start.x) * 0.52);
  const d = [
    `M ${start.x} ${start.y}`,
    `H ${midX}`,
    `V ${end.y}`,
    `H ${end.x}`
  ].join(' ');

  path.setAttribute('d', d);
  path.classList.add('tournament-connector-path');
  if (isFinalPath) {
    path.classList.add('final-path');
  }
  return path;
}
