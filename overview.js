import {
    initializePageShell,
    renderGlobalConnection,
    getAuthStatus,
    loadRevenueState,
    buildRevenueMetrics,
    loadLiveDataset,
    buildCatalogMetrics,
    renderRankList,
    renderDonutChart,
    renderTableEmpty,
    formatCurrency,
    formatCompactNumber,
    formatNumber,
    formatPercent,
    formatMonth,
    formatDate,
    formatDateTime,
    trimText,
    escapeHtml,
    showToast
} from "./data.js";

init();

async function init() {
    initializePageShell();
    showQueryToast();

    const revenueState = loadRevenueState();
    const revenueMetrics = buildRevenueMetrics(revenueState.statements);
    const authStatus = await getAuthStatus();
    renderGlobalConnection(authStatus, "Overview");

    const liveDataset = await loadLiveDataset({ status: authStatus });
    const catalogMetrics = buildCatalogMetrics(liveDataset.profile, liveDataset.tracks, revenueMetrics);

    renderOverview(revenueMetrics, catalogMetrics, liveDataset, authStatus);
}

function renderOverview(revenueMetrics, catalogMetrics, liveDataset, authStatus) {
    const liveTitle = document.getElementById("spotlightLiveTitle");
    const liveMeta = document.getElementById("spotlightLiveMeta");
    const revenueTitle = document.getElementById("spotlightRevenueTitle");
    const revenueMeta = document.getElementById("spotlightRevenueMeta");
    const gapTitle = document.getElementById("spotlightGapTitle");
    const gapMeta = document.getElementById("spotlightGapMeta");

    document.getElementById("heroLiveSyncPill").textContent = authStatus.connected
        ? "Live sync connected"
        : liveDataset.fromCache
            ? "Cached live snapshot"
            : "Live sync offline";
    document.getElementById("heroStatementPill").textContent = `${revenueMetrics.statementCount} statement${revenueMetrics.statementCount === 1 ? "" : "s"} loaded`;
    document.getElementById("heroMonetizedPill").textContent = `${catalogMetrics.monetizedCount} monetized tracks`;

    if (catalogMetrics.topPlayed) {
        liveTitle.textContent = trimText(catalogMetrics.topPlayed.title, 30);
        liveMeta.textContent = `${formatCompactNumber(catalogMetrics.topPlayed.plays)} plays · ${formatPercent(catalogMetrics.topPlayed.engagementRate)} engagement`;
    }

    if (revenueMetrics.bestTrack) {
        revenueTitle.textContent = trimText(revenueMetrics.bestTrack.name, 30);
        revenueMeta.textContent = `${formatCurrency(revenueMetrics.bestTrack.revenue)} · ${formatNumber(revenueMetrics.bestTrack.units)} reported streams`;
    }

    if (catalogMetrics.topUnmonetized) {
        gapTitle.textContent = trimText(catalogMetrics.topUnmonetized.title, 30);
        gapMeta.textContent = `${formatCompactNumber(catalogMetrics.topUnmonetized.plays)} plays without a payout match yet`;
    }

    renderConnectionPanel(revenueMetrics, liveDataset, authStatus, catalogMetrics);
    renderMetricCards(revenueMetrics, catalogMetrics);

    renderRankList(document.getElementById("overviewPlayRanks"), catalogMetrics.mergedTracks.slice(0, 8), {
        emptyMessage: "Connect SoundCloud to populate this ranking.",
        titleAccessor: (track) => track.title,
        valueAccessor: (track) => track.plays,
        mainValueFormatter: formatCompactNumber,
        detailFormatter: (track) => `${track.isMonetized ? formatCurrency(track.reportedRevenue) : "No payout match"} · ${track.sharing}`,
        secondaryFormatter: (track) => `${formatPercent(track.engagementRate)} engagement`
    });

    renderCatalogSplit(catalogMetrics);
    renderOverviewTable(catalogMetrics.mergedTracks.slice(0, 12));
}

function renderConnectionPanel(revenueMetrics, liveDataset, authStatus, catalogMetrics) {
    const connectionDot = document.getElementById("connectionDot");
    const connectionStatusTitle = document.getElementById("connectionStatusTitle");
    const connectionStatusCopy = document.getElementById("connectionStatusCopy");
    const profileValue = document.getElementById("profileValue");
    const lastSyncValue = document.getElementById("lastSyncValue");
    const archiveValue = document.getElementById("archiveValue");
    const coverageTitle = document.getElementById("coverageTitle");
    const coverageCopy = document.getElementById("coverageCopy");

    connectionDot.classList.toggle("connected", authStatus.connected);

    if (!authStatus.serverReachable) {
        connectionStatusTitle.textContent = "Local server offline";
        connectionStatusCopy.textContent = "Start the bundled Node server to enable SoundCloud OAuth and always-updated live catalog stats.";
    } else if (authStatus.configurationMissing) {
        connectionStatusTitle.textContent = "SoundCloud app keys missing";
        connectionStatusCopy.textContent = "Fill in .env with your SoundCloud client id, client secret, and redirect URI before connecting.";
    } else if (authStatus.connected) {
        connectionStatusTitle.textContent = "Connected to SoundCloud";
        connectionStatusCopy.textContent = "Live profile data and track metrics are available. Revenue metrics are merged from the local payout archive.";
    } else if (liveDataset.fromCache) {
        connectionStatusTitle.textContent = "Using cached live snapshot";
        connectionStatusCopy.textContent = "The last successful live sync is still available locally even while the current session is offline.";
    } else {
        connectionStatusTitle.textContent = "Ready to authorize";
        connectionStatusCopy.textContent = "Connect your SoundCloud account to unlock total plays, per-song metrics, and live catalog breakdowns.";
    }

    profileValue.textContent = liveDataset.profile?.username || "Not loaded";
    lastSyncValue.textContent = liveDataset.updatedAt ? formatDateTime(liveDataset.updatedAt) : "Never";
    archiveValue.textContent = `${revenueMetrics.statementCount} file${revenueMetrics.statementCount === 1 ? "" : "s"}`;

    if (!catalogMetrics.totalTracks) {
        coverageTitle.textContent = "Monetized coverage";
        coverageCopy.textContent = "Once live tracks are available, the dashboard will tell you how much of the catalog is currently matched to payout data.";
        return;
    }

    coverageTitle.textContent = `${formatPercent(catalogMetrics.monetizedShare)} catalog matched`;
    if (catalogMetrics.oldestEarner) {
        coverageCopy.textContent = `${catalogMetrics.monetizedCount} of ${catalogMetrics.totalTracks} tracks are matched to payouts. Oldest matched track: ${trimText(catalogMetrics.oldestEarner.title, 28)} · ${formatDate(catalogMetrics.oldestEarner.created_at)}.`;
    } else {
        coverageCopy.textContent = `${catalogMetrics.monetizedCount} of ${catalogMetrics.totalTracks} live tracks are currently matched to the imported payout archive.`;
    }
}

function renderMetricCards(revenueMetrics, catalogMetrics) {
    document.getElementById("totalPlaysMetric").textContent = formatCompactNumber(catalogMetrics.totalPlays);
    document.getElementById("totalPlaysMeta").textContent = catalogMetrics.topPlayed
        ? `Top live track: ${trimText(catalogMetrics.topPlayed.title, 32)}.`
        : "Requires a live SoundCloud connection.";

    document.getElementById("catalogTracksMetric").textContent = formatNumber(catalogMetrics.totalTracks);
    document.getElementById("catalogTracksMeta").textContent = catalogMetrics.totalTracks
        ? `${formatNumber(catalogMetrics.privateCount)} private track${catalogMetrics.privateCount === 1 ? "" : "s"} inside the fetched catalog.`
        : "Tracks will appear after your first sync.";

    document.getElementById("monetizedShareMetric").textContent = formatPercent(catalogMetrics.monetizedShare);
    document.getElementById("monetizedShareMeta").textContent = catalogMetrics.totalTracks
        ? `${formatNumber(catalogMetrics.monetizedCount)} tracks currently match imported payout data.`
        : "Based on track title or ISRC matches.";

    document.getElementById("reportedRevenueMetric").textContent = formatCurrency(revenueMetrics.totalRevenue);
    document.getElementById("reportedRevenueMeta").textContent = revenueMetrics.bestMonth
        ? `Best month: ${formatCurrency(revenueMetrics.bestMonth.revenue)} in ${formatMonth(revenueMetrics.bestMonth.month)}.`
        : "Import SoundCloud payout CSV files on the Revenue page.";

    document.getElementById("publicShareMetric").textContent = formatPercent(catalogMetrics.publicShare);
    document.getElementById("publicShareMeta").textContent = catalogMetrics.totalTracks
        ? `${formatNumber(catalogMetrics.publicCount)} public tracks inside the current catalog.`
        : "Useful to understand how much of the catalog is publicly exposed.";

    document.getElementById("avgPlaysMetric").textContent = formatCompactNumber(catalogMetrics.averagePlays);
    document.getElementById("avgPlaysMeta").textContent = catalogMetrics.totalTracks
        ? `${formatPercent(catalogMetrics.playsOnMonetizedShare)} of total plays sit on monetized tracks.`
        : "A fast signal for catalog depth versus concentration.";
}

function renderCatalogSplit(catalogMetrics) {
    renderDonutChart(
        document.getElementById("catalogSplitChart"),
        document.getElementById("catalogSplitLegend"),
        [
            { label: "Public + monetized", value: catalogMetrics.splitCounts.publicMonetized, color: "#ff7a18", meta: `${formatNumber(catalogMetrics.splitCounts.publicMonetized)} tracks` },
            { label: "Public + no match", value: catalogMetrics.splitCounts.publicUnmonetized, color: "#00d1c7", meta: `${formatNumber(catalogMetrics.splitCounts.publicUnmonetized)} tracks` },
            { label: "Private + monetized", value: catalogMetrics.splitCounts.privateMonetized, color: "#ff4d8d", meta: `${formatNumber(catalogMetrics.splitCounts.privateMonetized)} tracks` },
            { label: "Private + no match", value: catalogMetrics.splitCounts.privateUnmonetized, color: "#4ade80", meta: `${formatNumber(catalogMetrics.splitCounts.privateUnmonetized)} tracks` }
        ],
        {
            emptyMessage: "Connect SoundCloud to build the catalog split.",
            centerPrimary: formatNumber(catalogMetrics.hiddenStatsCount),
            centerSecondary: "quiet-mode tracks"
        }
    );
}

function renderOverviewTable(tracks) {
    const tbody = document.querySelector("#overviewTable tbody");
    if (!tracks.length) {
        renderTableEmpty(tbody, 6, "Connect SoundCloud to populate the combined catalog table.");
        return;
    }

    tbody.innerHTML = tracks.map((track) => `
        <tr>
            <td>${escapeHtml(trimText(track.title, 42))}</td>
            <td>${formatCompactNumber(track.plays)}</td>
            <td>${formatCurrency(track.reportedRevenue)}</td>
            <td>${formatNumber(track.reportedStreams)}</td>
            <td>${track.isMonetized ? "Yes" : "No"}</td>
            <td>${escapeHtml(track.sharing === "private" ? "Private" : "Public")}${track.revealStats ? "" : " · quiet"}</td>
        </tr>
    `).join("");
}

function showQueryToast() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
        showToast("SoundCloud account connected.");
    }
}