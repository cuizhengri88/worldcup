// js/main.js

function showReason(teamName, odds, reasonText) {
    document.getElementById('titleTeam').innerText = '📊 ' + teamName + ' 월드컵 매치 분석 보고서';
    document.getElementById('labelOdds').innerText = odds;
    document.getElementById('labelReason').innerText = reasonText;

    var modalEl = document.getElementById('analysisModal');
    var modalTarget = bootstrap.Modal.getOrCreateInstance(modalEl);
    if (modalEl.classList.contains('show')) {
        modalTarget.handleUpdate();
    } else {
        modalTarget.show();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    var modalEl = document.getElementById('analysisModal');
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', function() {
            document.querySelectorAll('.modal-backdrop').forEach(function(backdrop) {
                backdrop.remove();
            });
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('padding-right');
        });
    }

    document.querySelectorAll('.team-row-btn[data-team]').forEach(function(button) {
        button.addEventListener('click', function() {
            showReason(button.dataset.team, button.dataset.odds, button.dataset.reason);
        });
    });
});
