import {
    initializePageShell,
    renderGlobalConnection,
    getAuthStatus,
    loadLiveDataset,
    loadRevenueState,
    buildRevenueMetrics,
    buildCatalogMetrics,
    formatCompactNumber,
    formatCurrency,
    formatDuration,
    formatNumber,
    formatPercent,
    formatDate,
    formatDateTime,
    trimText,
    escapeHtml,
    renderEmptyState,
    showToast
} from "./data.js";

const filters = {
    search: "",
    sort: "plays-desc",
    scope: "all"
};

const revenueMetrics = buildRevenueMetrics(loadRevenueState().statements);
let authStatus = null;
let liveDataset = null;
let catalogMetrics = null;

init();

async function init() {
    initializePageShell();
    bindControls();

    authStatus = await getAuthStatus();
    renderGlobalConnection(authStatus, "Track explorer");

    await refreshCatalog(false);
}

function bindControls() {
    document.getElementById("trackSearchInput").addEventListener("input", (event) => {
        filters.search = event.target.value.trim().toLowerCase();
        renderTrackExplorer();
    });

    document.getElementById("trackSortSelect").addEventListener("change", (event) => {
        filters.sort = event.target.value;
        renderTrackExplorer();
    });

    document.getElementById("trackFilterSelect").addEventListener("change", (event) => {
        filters.scope = event.target.value;
        renderTrackExplorer();
    });

    document.getElementById("refreshTracksButton").addEventListener("click", async () => {
        await refreshCatalog(true);
    });
}

async function refreshCatalog(forceRefresh) {
    authStatus = await getAuthStatus();
    renderGlobalConnection(authStatus, "Track explorer");
    liveDataset = await loadLiveDataset({ forceRefresh, status: authStatus });
    catalogMetrics = buildCatalogMetrics(liveDataset.profile, liveDataset.tracks, revenueMetrics);

    if (forceRefresh) {
        showToast(liveDataset.connected ? "Live tracks refreshed." : liveDataset.fromCache ? "Live server unavailable, using cached snapshot." : "Unable to refresh live tracks.");
    }

    renderTrackExplorer();
}

function renderTrackExplorer() {
    renderStatusPanel();
    renderTrackMetrics();
    renderTrackCards();
}

function renderStatusPanel() {
    document.getElementById("trackPageCountPill").textContent = `${formatNumber(catalogMetrics.totalTracks)} tracks loaded`;
    document.getElementById("trackPageMonetizedPill").textContent = `${formatNumber(catalogMetrics.monetizedCount)} monetized matches`;
    document.getElementById("trackPageHiddenPill").textContent = `${formatNumber(catalogMetrics.hiddenStatsCount)} hidden-stat tracks`;

    const title = document.getElementById("trackStatusTitle");
    const copy = document.getElementById("trackStatusCopy");

    if (!authStatus.serverReachable) {
        title.textContent = "Local server offline";
        copy.textContent = "Start the bundled Node server to pull the authenticated SoundCloud catalog.";
    } else if (authStatus.configurationMissing) {
        title.textContent = "SoundCloud app keys missing";
        copy.textContent = "Add your client id, client secret, and redirect URI to .env before connecting.";
    } else if (authStatus.connected) {
        title.textContent = "Connected to SoundCloud";
        copy.textContent = "Live per-track stats are available. Revenue matches come from the imported payout archive.";
    } else if (liveDataset.fromCache) {
        title.textContent = "Using cached track snapshot";
        copy.textContent = "The explorer is currently showing the last successful live sync stored in the browser.";
    } else {
        title.textContent = "No live catalog yet";
        copy.textContent = "Connect SoundCloud and refresh the track feed to unlock the explorer.";
    }

    document.getElementById("tracksLastSyncValue").textContent = liveDataset.updatedAt ? formatDateTime(liveDataset.updatedAt) : "Never";
    document.getElementById("tracksResultCountValue").textContent = formatNumber(getVisibleTracks().length);
}

function renderTrackMetrics() {
    document.getElementById("tracksMonetizedMetric").textContent = formatNumber(catalogMetrics.monetizedCount);
    document.getElementById("tracksMonetizedMeta").textContent = catalogMetrics.totalTracks
        ? `${formatPercent(catalogMetrics.monetizedShare)} of the live catalog matches payout data.`
        : "Imported revenue and live catalog overlap.";

    document.getElementById("tracksHiddenMetric").textContent = formatNumber(catalogMetrics.hiddenStatsCount);
    document.getElementById("tracksHiddenMeta").textContent = catalogMetrics.totalTracks
        ? `${formatPercent(catalogMetrics.hiddenStatsShare)} of the catalog is in quiet mode.`
        : "Tracks hiding public stats on SoundCloud.";

    document.getElementById("tracksEngagementMetric").textContent = formatPercent(catalogMetrics.averageEngagementRate);
    document.getElementById("tracksEngagementMeta").textContent = catalogMetrics.topPlayed
        ? `Top live song: ${trimText(catalogMetrics.topPlayed.title, 28)}.`
        : "Engagement intensity across the fetched catalog.";

    document.getElementById("tracksGapMetric").textContent = catalogMetrics.topUnmonetized ? trimText(catalogMetrics.topUnmonetized.title, 22) : "-";
    document.getElementById("tracksGapMeta").textContent = catalogMetrics.topUnmonetized
        ? `${formatCompactNumber(catalogMetrics.topUnmonetized.plays)} plays without a payout match yet.`
        : "This one deserves attention if plays are high.";
}

function renderTrackCards() {
    const grid = document.getElementById("trackCardGrid");
    const tracks = getVisibleTracks();

    if (!tracks.length) {
        renderEmptyState(grid, catalogMetrics.totalTracks
            ? "No tracks match the current search and filter combination."
            : "Connect SoundCloud to populate the explorer with live track cards.");
        return;
    }

    grid.innerHTML = tracks.map((track) => `
        <article class="track-card">
            <div class="track-top">
                <div>
                    <h3 class="track-title">${escapeHtml(trimText(track.title, 42))}</h3>
                    <span class="track-subtitle">${escapeHtml(track.genre || track.user?.username || "No genre")}</span>
                </div>
                <span class="badge ${track.isMonetized ? "money" : "live"}">${track.isMonetized ? "Monetized" : "Live only"}</span>
            </div>

            <div class="track-badge-stack">
                <span class="badge muted">${escapeHtml(track.sharing === "private" ? "Private" : "Public")}</span>
                <span class="badge live">${track.revealStats ? "Stats visible" : "Quiet mode"}</span>
                ${track.isrc ? `<span class="badge muted">ISRC</span>` : ""}
            </div>

            <div class="track-stats">
                <div class="track-stat">
                    <span>Plays</span>
                    <strong>${formatCompactNumber(track.plays)}</strong>
                </div>
                <div class="track-stat">
                    <span>Revenue</span>
                    <strong>${formatCurrency(track.reportedRevenue)}</strong>
                </div>
                <div class="track-stat">
                    <span>Likes</span>
                    <strong>${formatCompactNumber(track.likes)}</strong>
                </div>
                <div class="track-stat">
                    <span>RPM</span>
                    <strong>${formatCurrency(track.reportedRpm)}</strong>
                </div>
            </div>

            <div class="track-hover-panel">
                <div class="hover-grid">
                    <div class="hover-item">
                        <span>Comments</span>
                        <strong>${formatNumber(track.comments)}</strong>
                    </div>
                    <div class="hover-item">
                        <span>Reposts</span>
                        <strong>${formatNumber(track.reposts)}</strong>
                    </div>
                    <div class="hover-item">
                        <span>Duration</span>
                        <strong>${formatDuration(track.durationMs)}</strong>
                    </div>
                    <div class="hover-item">
                        <span>Match quality</span>
                        <strong>${escapeHtml(track.matchConfidence)}</strong>
                    </div>
                    <div class="hover-item">
                        <span>Reported streams</span>
                        <strong>${formatNumber(track.reportedStreams)}</strong>
                    </div>
                    <div class="hover-item">
                        <span>Created</span>
                        <strong>${escapeHtml(formatDate(track.created_at))}</strong>
                    </div>
                </div>
                ${track.permalink_url ? `<a class="track-link" href="${escapeHtml(track.permalink_url)}" target="_blank" rel="noreferrer">Open on SoundCloud</a>` : ""}
            </div>
        </article>
    `).join("");
}

function getVisibleTracks() {
    const filtered = catalogMetrics.mergedTracks.filter((track) => {
        if (filters.scope === "monetized" && !track.isMonetized) {
            return false;
        }
        if (filters.scope === "unmonetized" && track.isMonetized) {
            return false;
        }
        if (filters.scope === "public" && track.sharing === "private") {
            return false;
        }
        if (filters.scope === "private" && track.sharing !== "private") {
            return false;
        }

        if (!filters.search) {
            return true;
        }

        const haystack = [track.title, track.genre, track.isrc].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(filters.search);
    });

    const sorted = filtered.slice();
    sorted.sort((left, right) => {
        switch (filters.sort) {
            case "revenue-desc":
                return right.reportedRevenue - left.reportedRevenue;
            case "engagement-desc":
                return right.engagementRate - left.engagementRate;
            case "recent-desc":
                return right.createdTimestamp - left.createdTimestamp;
            case "rpm-desc":
                return right.reportedRpm - left.reportedRpm;
            case "plays-desc":
            default:
                return right.plays - left.plays;
        }
    });

    return sorted;
}